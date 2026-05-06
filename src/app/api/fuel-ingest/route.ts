// /api/fuel-ingest — triggered by Vercel Cron. Pulls Pilot Flying J pricing
// emails from Outlook (jfishback@simonexpress.com / KPI-FEED folder), forwards
// the attachment to the existing /api/fuel-upload pipeline, and moves processed
// emails to KPI-FEED/Processed.
//
// Triggered by:
//   - Vercel Cron (Authorization: Bearer ${CRON_SECRET})
//   - Manual test via ?key=${CRON_SECRET}

import { NextRequest, NextResponse } from 'next/server'
import {
  findFolderIdByName,
  ensureChildFolder,
  listFuelMessages,
  getMessageAttachments,
  markMessageRead,
  moveMessage,
} from '@/lib/graph'

// Pilot's known sender + subject. These are also overridable via env vars
// in case the address ever changes — you don't need a code deploy to adjust.
const DEFAULT_FROM = 'DailyPricing@pilotflyingj.com'
const DEFAULT_SUBJECT = 'Pricing - Pilot Flying J'

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  const auth = req.headers.get('authorization')
  if (auth === `Bearer ${cronSecret}`) return true
  const keyParam = req.nextUrl.searchParams.get('key')
  if (keyParam === cronSecret) return true
  return false
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

  if (!mailbox) {
    return NextResponse.json({ error: 'OUTLOOK_FUEL_MAILBOX not set' }, { status: 500 })
  }
  if (!fuelApiKey) {
    return NextResponse.json({ error: 'FUEL_API_KEY not set' }, { status: 500 })
  }

  const summary: any = {
    mailbox,
    folder: folderName,
    found: 0,
    processed: 0,
    skipped: 0,
    errors: [] as string[],
    details: [] as any[],
  }

  try {
    // 1. Resolve folder IDs
    const folderId = await findFolderIdByName(mailbox, folderName)
    if (!folderId) {
      return NextResponse.json({
        error: `Folder "${folderName}" not found in mailbox ${mailbox}. Check the folder exists at root level (not a subfolder of Inbox).`,
      }, { status: 404 })
    }
    const processedFolderId = await ensureChildFolder(mailbox, folderId, processedSubfolder)

    // 2. List unread Pilot pricing messages
    const messages = await listFuelMessages(mailbox, folderId, fromAddress, subjectContains)
    summary.found = messages.length

    if (messages.length === 0) {
      return NextResponse.json({ ...summary, message: 'No new fuel emails to process.' })
    }

    // 3. Process each message (typically just one per day)
    // We construct an absolute URL to /api/fuel-upload from the incoming request's host
    const origin = req.nextUrl.origin
    const fuelUploadUrl = `${origin}/api/fuel-upload`

    for (const msg of messages) {
      const detail: any = { id: msg.id, subject: msg.subject, receivedDateTime: msg.receivedDateTime, status: 'pending' }
      try {
        const attachments = await getMessageAttachments(mailbox, msg.id)
        // Pilot sends a single CSV or XLSX. Find the first one with a recognizable extension.
        const fuelAttachment = attachments.find(a =>
          /\.(csv|xlsx|xls)$/i.test(a.name) ||
          a.contentType.includes('spreadsheet') ||
          a.contentType.includes('csv')
        )
        if (!fuelAttachment) {
          detail.status = 'no-attachment'
          detail.note = `Attachments found: ${attachments.map(a => a.name).join(', ') || 'none'}`
          summary.skipped++
          await markMessageRead(mailbox, msg.id)
          summary.details.push(detail)
          continue
        }

        // Convert base64 to a Blob and POST to /api/fuel-upload
        const binary = Buffer.from(fuelAttachment.contentBytes, 'base64')
        const formData = new FormData()
        const fileBlob = new Blob([new Uint8Array(binary)], { type: fuelAttachment.contentType })
        formData.append('file', fileBlob, fuelAttachment.name)
        formData.append('apiKey', fuelApiKey)

        const uploadRes = await fetch(fuelUploadUrl, { method: 'POST', body: formData })
        if (!uploadRes.ok) {
          const errText = await uploadRes.text()
          throw new Error(`fuel-upload returned ${uploadRes.status}: ${errText.substring(0, 300)}`)
        }
        const uploadJson = await uploadRes.json().catch(() => ({}))
        detail.status = 'uploaded'
        detail.attachmentName = fuelAttachment.name
        detail.attachmentSize = fuelAttachment.size
        detail.uploadResponse = uploadJson

        // Move to Processed folder so we don't process it again
        await moveMessage(mailbox, msg.id, processedFolderId)
        detail.status = 'archived'
        summary.processed++
      } catch (err: any) {
        detail.status = 'error'
        detail.error = err?.message || String(err)
        summary.errors.push(`${msg.subject}: ${err?.message || err}`)
        // Don't mark as read on error — leave it unread so it'll be retried
      }
      summary.details.push(detail)
    }

    return NextResponse.json(summary)
  } catch (err: any) {
    summary.errors.push(err?.message || String(err))
    return NextResponse.json({ ...summary, error: err?.message || 'Internal error' }, { status: 500 })
  }
}
