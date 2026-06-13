// TEMPORARY one-time helper: lists the dated PFJ price-snapshot blobs so kpi can
// backfill its fuel_price_history table. Gated by SNAP_KEY. Remove after backfill.
import { NextRequest, NextResponse } from 'next/server'
import { list } from '@vercel/blob'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const key = process.env.SNAP_KEY
  if (!key || req.nextUrl.searchParams.get('key') !== key) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const out: { pathname: string; url: string; uploadedAt?: string }[] = []
  let cursor: string | undefined
  do {
    const res = await list({ prefix: 'fuel-data-', cursor, limit: 1000 })
    for (const b of res.blobs) {
      if (/fuel-data-\d{4}-\d{2}-\d{2}\.json$/.test(b.pathname)) {
        out.push({ pathname: b.pathname, url: b.url, uploadedAt: (b as any).uploadedAt })
      }
    }
    cursor = res.cursor
  } while (cursor)
  out.sort((a, b) => a.pathname.localeCompare(b.pathname))
  return NextResponse.json({ count: out.length, snapshots: out })
}
