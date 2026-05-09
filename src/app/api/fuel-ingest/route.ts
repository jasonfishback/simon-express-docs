import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import * as XLSX from 'xlsx'
import {
  findFolderIdByName,
  ensureChildFolder,
  listFuelMessages,
  getMessageAttachments,
  markMessageRead,
  moveMessage,
} from '@/lib/graph'
import { enrichStations } from '@/lib/fuel/enrich'

const DEFAULT_FROM = 'DailyPricing@pilotflyingj.com'
const DEFAULT_SUBJECT = 'Pricing - Pilot Flying J'

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

interface ParsedStation {
  site: string
  city: string
  state: string
  retailPrice: number
  yourPrice: number
  savings: number
}

// Parse a Pilot Flying J pricing .xls file (binary) and extract station rows.
// Header is on row 5 (0-indexed), data starts row 6. Filters out non-DSL rows
// just in case any other product types ever appear.
function parsePilotXls(buffer: Buffer): ParsedStation[] {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  // Get raw 2D array — header: 1 means use the first row as keys but we don't want that.
  // Easier: get values as array-of-arrays so we can index by column number.
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: true, defval: null })
  const stations: ParsedStation[] = []
  // Find header row by looking for "Site" + "City" + "ST" in the same row
  let headerRow = -1
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i] || []
    if (
      String(r[0] || '').trim() === 'Site' &&
      String(r[1] || '').trim() === 'City' &&
      String(r[2] || '').trim() === 'ST'
    ) {
      headerRow = i
      break
    }
  }
  if (headerRow < 0) {
    throw new Error('Could not find header row (Site / City / ST) in Pilot xls')
  }
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const site = r[0]
    const city = r[1]
    const state = r[2]
    const prod = r[3]
    const retail = r[17]
    const yours = r[19]
    const savings = r[20]
    // Skip blank rows or non-diesel rows
    if (site == null || city == null || state == null) continue
    if (prod != null && String(prod).trim().toUpperCase() !== 'DSL') continue
    const yourNum = Number(yours)
    const retailNum = Number(retail)
    const savNum = Number(savings)
    if (!isFinite(yourNum) || yourNum <= 0) continue
    stations.push({
      site: String(site).trim(),
      city: String(city).trim(),
      state: String(state).trim().toUpperCase(),
      retailPrice: isFinite(retailNum) ? retailNum : 0,
      yourPrice: yourNum,
      savings: isFinite(savNum) ? savNum : 0,
    })
  }
  return stations
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const mailbox = process.env.OUTLOOK_FUEL_MAILBOX
  const folderName = process.env.OUTLOOK_FUEL_FOLDER || 'KPI-FEED'
  const processedSubfolder = process.env.OUTLOOK_PROCESSED_FOLDER || 'Processed'
  const fromAddress = process.env.OUTLOOK_FUEL_FROM || DEFAULT_FROM
  const subjectContains = process.env.OUTLOOK_FUEL_SUBJECT || DEFAULT_SUBJECT
  const fuelApiKey = process.env.FUEL_API_KEY

  if (!mailbox) return NextResponse.json({ error: 'OUTLOOK_FUEL_MAILBOX not set' }, { status: 500 })
  if (!fuelApiKey) return NextResponse.json({ error: 'FUEL_API_KEY not set' }, { status: 500 })

  const summary: any = { mailbox, folder: folderName, found: 0, processed: 0, skipped: 0, errors: [] as string[], details: [] as any[] }

  try {
    const folderId = await findFolderIdByName(mailbox, folderName)
    if (!folderId) {
      return NextResponse.json({ error: `Folder "${folderName}" not found in mailbox ${mailbox}.` }, { status: 404 })
    }
    const processedFolderId = await ensureChildFolder(mailbox, folderId, processedSubfolder)

    const messages = await listFuelMessages(mailbox, folderId, fromAddress, subjectContains)
    summary.found = messages.length
    if (messages.length === 0) {
      return NextResponse.json({ ...summary, message: 'No new fuel emails to process.' })
    }

    for (const msg of messages) {
      const detail: any = { id: msg.id, subject: msg.subject, receivedDateTime: msg.receivedDateTime, status: 'pending' }
      try {
        const attachments = await getMessageAttachments(mailbox, msg.id)
        // Pilot sends a single .xls. Find it.
        const xlsAttachment = attachments.find(a =>
          /\.(xls|xlsx)$/i.test(a.name) ||
          a.contentType.includes('spreadsheet') ||
          a.contentType.includes('excel')
        )
        if (!xlsAttachment) {
          detail.status = 'no-attachment'
          detail.note = `Attachments: ${attachments.map(a => a.name).join(', ') || 'none'}`
          summary.skipped++
          await markMessageRead(mailbox, msg.id)
          summary.details.push(detail)
          continue
        }

        // Decode base64 -> Buffer -> parse Excel inline
        const buffer = Buffer.from(xlsAttachment.contentBytes, 'base64')
        const stations = parsePilotXls(buffer)
        detail.attachmentName = xlsAttachment.name
        detail.attachmentSize = xlsAttachment.size
        detail.parsedStations = stations.length

        if (stations.length === 0) {
          throw new Error('Parser returned 0 stations — file format may have changed')
        }

        // Enrich pricing rows with cached lat/lng/address/zip/phone.
        // Without this, /api/fuel-upload would write rows missing coords,
        // which makes the route planner return zero matches on every search.
        const { stations: enriched, cacheHits, cacheMisses } = enrichStations(stations)
        detail.cacheHits = cacheHits
        detail.cacheMisses = cacheMisses.length
        if (cacheMisses.length > 0) {
          detail.cacheMissKeys = cacheMisses
          console.warn(`Fuel ingest: ${cacheMisses.length} stations missing from coord cache:`, cacheMisses.join(', '))
        }

        // Write directly to Vercel Blob — no internal HTTP call.
        // Going through /api/fuel-upload caused 401s because Vercel Cron hits
        // the protected deployment URL, and inner fetches inherit that origin
        // and get bounced by Deployment Protection before reaching the handler.
        const updatedAt = new Date().toISOString().split('T')[0]
        const fuelData = { updatedAt, stations: enriched }
        const blob = await put('fuel-data.json', JSON.stringify(fuelData), {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'application/json',
          allowOverwrite: true,
        })
        console.log(`[fuel-ingest] Blob written: ${blob.url} (${enriched.length} stations, updatedAt=${updatedAt})`)
        const uploadJson = { success: true, count: enriched.length, updatedAt, blobUrl: blob.url }
        detail.status = 'uploaded'
        detail.uploadResponse = uploadJson

        await moveMessage(mailbox, msg.id, processedFolderId)
        detail.status = 'archived'
        summary.processed++
      } catch (err: any) {
        detail.status = 'error'
        detail.error = err?.message || String(err)
        summary.errors.push(`${msg.subject}: ${err?.message || err}`)
      }
      summary.details.push(detail)
    }

    return NextResponse.json(summary)
  } catch (err: any) {
    summary.errors.push(err?.message || String(err))
    return NextResponse.json({ ...summary, error: err?.message || 'Internal error' }, { status: 500 })
  }
}
