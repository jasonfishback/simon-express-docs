// Lightweight usage log stored in Vercel Blob as a single JSON file.
// Each entry records when a driver sent themselves (or any recipient) a fuel plan.
// The log is read+rewritten on every send. Volume is low (< 30 sends/day), so a single
// blob file works fine. Old entries (> 30 days) are pruned on each write to keep size bounded.

import { put, list } from '@vercel/blob'

export interface UsageEntry {
  timestamp: string         // ISO 8601
  recipientEmail: string
  recipientName?: string    // From recipients.ts lookup if available
  truckNumber?: string
  origin: string
  destination: string
  miles: number
  gallons: number
  cost: number
  savings: number
  stopCount: number
}

const LOG_KEY = 'fuel-usage-log.json'
const MAX_AGE_DAYS = 30

// Try to find an existing log blob, return its parsed entries or empty array
async function loadLog(): Promise<UsageEntry[]> {
  try {
    const { blobs } = await list({ prefix: LOG_KEY })
    const blob = blobs.find(b => b.pathname === LOG_KEY)
    if (!blob) return []
    const res = await fetch(blob.url, { cache: 'no-store' })
    if (!res.ok) return []
    const text = await res.text()
    return JSON.parse(text) as UsageEntry[]
  } catch (err) {
    console.error('Failed to load usage log:', err)
    return []
  }
}

// Write the log back, pruning entries older than MAX_AGE_DAYS
async function saveLog(entries: UsageEntry[]): Promise<void> {
  const cutoff = Date.now() - (MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
  const fresh = entries.filter(e => {
    try { return new Date(e.timestamp).getTime() >= cutoff } catch { return false }
  })
  await put(LOG_KEY, JSON.stringify(fresh), {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
  })
}

// Append a new entry. Failures are swallowed so that send failures don't break the user flow.
export async function appendUsage(entry: UsageEntry): Promise<void> {
  try {
    const existing = await loadLog()
    existing.push(entry)
    await saveLog(existing)
  } catch (err) {
    // Logging failures must never break the actual fuel email — just record and move on
    console.error('Failed to append usage entry:', err)
  }
}

// Get all entries within the last N days
export async function getUsageSinceDays(days: number): Promise<UsageEntry[]> {
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000)
  const all = await loadLog()
  return all.filter(e => {
    try { return new Date(e.timestamp).getTime() >= cutoff } catch { return false }
  })
}
