// src/app/api/health/route.ts
// GET endpoint returning the heartbeat state of each cron.
// Auth accepts any of: CRON_SECRET, INGEST_API_KEY, DOCS_HEALTH_KEY.
// (Bearer header OR ?key=). Not public.
// DOCS_HEALTH_KEY is the dedicated key for the kpi site's health dashboard
// — separate from INGEST_API_KEY so we can rotate cross-repo access without
// touching the cron auth path.

import { NextRequest, NextResponse } from 'next/server'
import { readHeartbeats } from '@/lib/heartbeat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET || ''
  const ingestKey = process.env.INGEST_API_KEY || ''
  const docsHealthKey = process.env.DOCS_HEALTH_KEY || ''
  if (!cronSecret && !ingestKey && !docsHealthKey) return false

  const auth = req.headers.get('authorization') || ''
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true
  if (ingestKey && auth === `Bearer ${ingestKey}`) return true
  if (docsHealthKey && auth === `Bearer ${docsHealthKey}`) return true

  const keyParam = req.nextUrl.searchParams.get('key') || ''
  if (cronSecret && keyParam === cronSecret) return true
  if (ingestKey && keyParam === ingestKey) return true
  if (docsHealthKey && keyParam === docsHealthKey) return true

  return false
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const heartbeats = await readHeartbeats()
    return NextResponse.json(
      { heartbeats, fetchedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to read heartbeats' },
      { status: 500 }
    )
  }
}
