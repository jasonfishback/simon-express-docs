import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import {
  findFolderIdByName,
  listFuelMessages,
  getMessageAttachments,
  markMessageRead,
  deleteMessage,
  FuelAttachment,
} from '@/lib/graph'
import { parsePilotXls, parseLovesXlsx, parseTaXls, ParsedStation, FuelBrand } from '@/lib/fuel/parse'
import { enrichStations, EnrichedStation } from '@/lib/fuel/enrich'
import { recordHeartbeat } from '@/lib/heartbeat'

export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  // Accept either CRON_SECRET (Vercel-standard, used by Vercel Cron) or
  // INGEST_API_KEY (legacy, used for manual curl triggers). At least one
  // must be set, and the incoming token must match it.
  const cronSecret = process.env.CRON_SECRET || ''
  const ingestKey = process.env.INGEST_API_KEY || ''
  if (!cronSecret && !ingestKey) return false

  const auth = req.headers.get('authorization') || ''
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true
  if (ingestKey && auth === `Bearer ${ingestKey}`) return true

  const keyParam = req.nextUrl.searchParams.get('key') || ''
  if (cronSecret && keyParam === cronSecret) return true
  if (ingestKey && keyParam === ingestKey) return true

  return false
}

// ── Feed definitions ────────────────────────────────────────────────────────
// Each daily pricing email is a "feed": matched by sender + subject, parsed
// into brand-tagged station rows. A feed only ever replaces the brands it
// actually delivered — the Pilot email can't wipe Love's prices and vice
// versa. Emails arrive at different times of day, so the merged blob always
// carries each brand's last-known prices with a per-brand freshness stamp.
interface FeedDef {
  key: string
  from: string            // exact address, or "@domain.com" for any sender at that domain
  subjectContains: string
  // Parse every relevant attachment into station rows (may span brands).
  parse: (attachments: FuelAttachment[]) => { stations: ParsedStation[]; parsedFiles: string[] }
}

const isSpreadsheet = (a: FuelAttachment) =>
  /\.(xls|xlsx)$/i.test(a.name) || a.contentType.includes('spreadsheet') || a.contentType.includes('excel')

const FEEDS: FeedDef[] = [
  {
    key: 'pilot',
    from: process.env.OUTLOOK_FUEL_FROM || 'DailyPricing@pilotflyingj.com',
    subjectContains: process.env.OUTLOOK_FUEL_SUBJECT || 'Pricing - Pilot Flying J',
    parse: (attachments) => {
      const xls = attachments.find(isSpreadsheet)
      if (!xls) return { stations: [], parsedFiles: [] }
      return {
        stations: parsePilotXls(Buffer.from(xls.contentBytes, 'base64')),
        parsedFiles: [xls.name],
      }
    },
  },
  {
    key: 'england',
    // Forwarded daily by England Logistics (Love's + TA/Petro cost-plus).
    from: '@englandlogistics.com',
    subjectContains: 'Cost-Plus',
    parse: (attachments) => {
      const stations: ParsedStation[] = []
      const parsedFiles: string[] = []
      for (const a of attachments.filter(isSpreadsheet)) {
        const buffer = Buffer.from(a.contentBytes, 'base64')
        if (/loves/i.test(a.name)) {
          stations.push(...parseLovesXlsx(buffer))
          parsedFiles.push(a.name)
        } else if (/ta\s?petro|tapetro/i.test(a.name)) {
          stations.push(...parseTaXls(buffer))
          parsedFiles.push(a.name)
        }
      }
      return { stations, parsedFiles }
    },
  },
]

interface FuelBlob {
  updatedAt: string
  stations: EnrichedStation[]
  // Per-brand freshness: when each brand's prices last arrived + row count.
  brands?: Partial<Record<FuelBrand, { updatedAt: string; count: number }>>
}

async function loadCurrentBlob(): Promise<FuelBlob | null> {
  const blobUrl = process.env.FUEL_BLOB_URL
  if (!blobUrl) return null
  try {
    const res = await fetch(blobUrl, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data?.stations)) return null
    return data as FuelBlob
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const mailbox = process.env.OUTLOOK_FUEL_MAILBOX
  const folderName = process.env.OUTLOOK_FUEL_FOLDER || 'KPI-FEED'

  if (!mailbox) return NextResponse.json({ error: 'OUTLOOK_FUEL_MAILBOX not set' }, { status: 500 })

  const summary: any = { mailbox, folder: folderName, found: 0, processed: 0, skipped: 0, errors: [] as string[], details: [] as any[] }

  try {
    const folderId = await findFolderIdByName(mailbox, folderName)
    if (!folderId) {
      return NextResponse.json({ error: `Folder "${folderName}" not found in mailbox ${mailbox}.` }, { status: 404 })
    }

    for (const feed of FEEDS) {
      const messages = await listFuelMessages(mailbox, folderId, feed.from, feed.subjectContains)
      summary.found += messages.length

      for (const msg of messages) {
        const detail: any = { feed: feed.key, id: msg.id, subject: msg.subject, receivedDateTime: msg.receivedDateTime, status: 'pending' }
        try {
          const attachments = await getMessageAttachments(mailbox, msg.id)
          const { stations, parsedFiles } = feed.parse(attachments)
          detail.parsedFiles = parsedFiles
          detail.parsedStations = stations.length

          if (stations.length === 0) {
            // Matching email with no parseable pricing file — leave it (read)
            // for eyes, don't delete data we couldn't extract.
            detail.status = 'no-pricing-attachment'
            detail.note = `Attachments: ${attachments.map(a => a.name).join(', ') || 'none'}`
            summary.skipped++
            await markMessageRead(mailbox, msg.id)
            summary.details.push(detail)
            continue
          }

          // Enrich with cached coords/address/name per brand.
          const { stations: enriched, cacheHits, cacheMisses } = enrichStations(stations)
          detail.cacheHits = cacheHits
          detail.cacheMisses = cacheMisses.length
          if (cacheMisses.length > 0) {
            detail.cacheMissKeys = cacheMisses.slice(0, 30)
            console.warn(`[fuel-ingest] ${cacheMisses.length} stations missing from coord cache:`, cacheMisses.slice(0, 30).join(', '))
          }
          if (enriched.length === 0) {
            throw new Error('All parsed stations were dropped in enrichment — coord cache may be missing')
          }

          // Merge: replace only the brands this email actually delivered.
          const delivered = Array.from(new Set(enriched.map(s => s.brand))) as FuelBrand[]
          const current = await loadCurrentBlob()
          const kept = (current?.stations || []).filter(s => !delivered.includes((s.brand || 'pfj') as FuelBrand))
          const merged = [...kept, ...enriched]

          const emailDate = (msg.receivedDateTime || new Date().toISOString()).split('T')[0]
          const brands: FuelBlob['brands'] = { ...(current?.brands || {}) }
          for (const b of delivered) {
            brands[b] = { updatedAt: emailDate, count: enriched.filter(s => s.brand === b).length }
          }
          // Backfill a stamp for pre-multibrand PFJ rows we kept.
          if (!brands.pfj && kept.some(s => (s.brand || 'pfj') === 'pfj')) {
            brands.pfj = { updatedAt: current?.updatedAt || emailDate, count: kept.filter(s => (s.brand || 'pfj') === 'pfj').length }
          }
          const updatedAt = Object.values(brands).reduce((max, b) => (b && b.updatedAt > max ? b.updatedAt : max), emailDate)

          const fuelData: FuelBlob = { updatedAt, stations: merged, brands }
          const fuelDataJson = JSON.stringify(fuelData)
          // Live blob (what both optimizers read)
          const blob = await put('fuel-data.json', fuelDataJson, {
            access: 'public',
            addRandomSuffix: false,
            contentType: 'application/json',
            allowOverwrite: true,
          })
          // Dated archive snapshot (daily history for trend analysis / kpi
          // price-history backfills). Keyed by processing date.
          const today = new Date().toISOString().split('T')[0]
          const snapshotBlob = await put(`fuel-data-${today}.json`, fuelDataJson, {
            access: 'public',
            addRandomSuffix: false,
            contentType: 'application/json',
            allowOverwrite: true,
          })
          console.log(`[fuel-ingest] ${feed.key}: blob written (${merged.length} stations, brands=${delivered.join('+')}, updatedAt=${updatedAt}); snapshot: ${snapshotBlob.url}`)
          detail.uploadResponse = { success: true, count: merged.length, delivered, updatedAt, blobUrl: blob.url, snapshotUrl: snapshotBlob.url }

          await deleteMessage(mailbox, msg.id)
          detail.status = 'deleted'
          summary.processed++
        } catch (err: any) {
          detail.status = 'error'
          detail.error = err?.message || String(err)
          const msgText = `${msg.subject}: ${err?.message || err}`
          summary.errors.push(msgText)
          console.error(`[fuel-ingest] per-message error: ${msgText}`, err?.stack || '')
        }
        summary.details.push(detail)
      }
    }

    if (summary.found === 0) {
      await recordHeartbeat('fuel_ingest', {
        status: 'ok',
        recordCount: 0,
        message: 'no new emails',
      })
      return NextResponse.json({ ...summary, message: 'No new fuel emails to process.' })
    }

    await recordHeartbeat('fuel_ingest', {
      status: summary.errors.length > 0 && summary.processed === 0 ? 'error' : 'ok',
      recordCount: summary.processed,
      message: summary.errors.length > 0 ? `${summary.errors.length} per-message errors` : null,
    })
    return NextResponse.json(summary)
  } catch (err: any) {
    const msgText = err?.message || String(err)
    summary.errors.push(msgText)
    console.error(`[fuel-ingest] FATAL: ${msgText}`, err?.stack || '')
    await recordHeartbeat('fuel_ingest', {
      status: 'error',
      recordCount: null,
      message: String(msgText).slice(0, 200),
    })
    return NextResponse.json({ ...summary, error: msgText || 'Internal error' }, { status: 500 })
  }
}
