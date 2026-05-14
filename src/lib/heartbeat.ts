// src/lib/heartbeat.ts
// Single Blob-backed JSON file holding the last-run record for each cron.
// Cheap (one read or one write per cron firing), survives deploys, no DB needed.

import { put, list } from '@vercel/blob'

export type HeartbeatStatus = 'ok' | 'error'

export interface Heartbeat {
  key: string                  // 'fuel_ingest' | 'dispatch_report' | ...
  lastRunAt: string            // ISO 8601
  status: HeartbeatStatus
  recordCount?: number | null  // optional: e.g. fuel-ingest stations parsed
  message?: string | null      // optional: short error text or note
}

const BLOB_KEY = 'cron-heartbeats.json'

async function loadAll(): Promise<Heartbeat[]> {
  try {
    const { blobs } = await list({ prefix: BLOB_KEY })
    const blob = blobs.find((b) => b.pathname === BLOB_KEY)
    if (!blob) return []
    const res = await fetch(blob.url, { cache: 'no-store' })
    if (!res.ok) return []
    const text = await res.text()
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed as Heartbeat[]
  } catch (err) {
    console.error('heartbeat: load failed', err)
    return []
  }
}

async function saveAll(entries: Heartbeat[]): Promise<void> {
  await put(BLOB_KEY, JSON.stringify(entries), {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
  })
}

/**
 * Record a heartbeat for the given cron key. Overwrites any previous entry
 * for that key. Swallows its own errors so a logging failure cannot break
 * the actual cron.
 */
export async function recordHeartbeat(
  key: string,
  partial: Omit<Heartbeat, 'key' | 'lastRunAt'>
): Promise<void> {
  try {
    const all = await loadAll()
    const next = all.filter((e) => e.key !== key)
    next.push({
      key,
      lastRunAt: new Date().toISOString(),
      status: partial.status,
      recordCount: partial.recordCount ?? null,
      message: partial.message ?? null,
    })
    await saveAll(next)
  } catch (err) {
    console.error(`heartbeat: failed to record ${key}`, err)
  }
}

/** Return all heartbeats. Used by /api/health. */
export async function readHeartbeats(): Promise<Heartbeat[]> {
  return loadAll()
}
