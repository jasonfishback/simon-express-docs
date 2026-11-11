import type { FuelAttachment } from '@/lib/graph'
import { pilotSheetAccount } from './parse'

// From 11/10/26 Pilot's daily pricing email ("<date> Price Quote - Pilot
// Flying J", daily.pricing@pilottravelcenters.com) carries NO attachment —
// just a "View Price Quote" link (valid 48h) that redirects to the day's
// pq-<account>-<MMDDYYYY>.xlsx. The link is wrapped in an SES click tracker
// (…awstrack.me/L0/<url-encoded target>/…), so the real target only appears
// after one round of percent-decoding.

const MAX_BYTES = 8 * 1024 * 1024

/** The "View Price Quote" target in a Pilot email body, or null if none. */
export function findPilotQuoteUrl(bodyHtml: string): string | null {
  const html = (bodyHtml || '').replace(/&amp;/gi, '&')
  // Decode %XX by hand: decodeURIComponent throws on a stray "%" in the body.
  const once = html.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  const re = /https:\/\/[a-z0-9.-]+\.pilotcloud\.net(?::\d+)?\/UrlValidation\/validate\?document=[0-9a-f-]+&hash=[A-Za-z0-9%+=_-]+/i
  return (html.match(re) || once.match(re))?.[0] ?? null
}

/** Download the linked sheet and present it as if it had been attached. */
export async function downloadPilotQuote(url: string): Promise<FuelAttachment> {
  const host = new URL(url).hostname.toLowerCase()
  if (!host.endsWith('.pilotcloud.net')) throw new Error(`unexpected price-quote host ${host}`)
  const res = await fetch(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`link returned HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new Error(`linked file is ${buf.length} bytes — too large to be a price sheet`)
  const isXlsx = buf[0] === 0x50 && buf[1] === 0x4b
  const isXls = buf[0] === 0xd0 && buf[1] === 0xcf
  if (!isXlsx && !isXls) {
    // An expired link answers with a page, not a workbook.
    const peek = buf.subarray(0, 120).toString('utf8').replace(/\s+/g, ' ')
    throw new Error(`link did not return a spreadsheet (${res.headers.get('content-type') || 'no content-type'}, ${buf.length} bytes): ${peek}`)
  }
  const disposition = res.headers.get('content-disposition') || ''
  let name = disposition.match(/filename="?([^";]+)"?/i)?.[1]?.trim() || ''
  if (!/\.(xls|xlsx)$/i.test(name)) {
    // No usable filename — name it from the account printed in the sheet so
    // the feed's account filter still works.
    name = `pq-${pilotSheetAccount(buf) ?? 'linked'}.${isXlsx ? 'xlsx' : 'xls'}`
  }
  return {
    id: 'linked',
    name,
    contentType: res.headers.get('content-type') || 'application/vnd.ms-excel',
    contentBytes: buf.toString('base64'),
    size: buf.length,
    kind: 'linkedFile',
  }
}
