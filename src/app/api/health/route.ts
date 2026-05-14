// src/app/api/health/route.ts
// GET endpoint returning the heartbeat state of each cron.
// Auth: same INGEST_API_KEY/CRON_SECRET pair as the other endpoints
// (Bearer header OR ?key=). Not public.

import { NextRequest, NextResponse } from 'next/server'
import { readHeartbeats } from '@/lib/heartbeat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(req: NextRequest): boolean {
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
