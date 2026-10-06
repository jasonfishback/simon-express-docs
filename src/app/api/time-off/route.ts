// src/app/api/time-off/route.ts
//
// Driver time-off requests. Identity comes ONLY from the sx_driver cookie
// (never the body) and is proxied to kpi, which validates the code against
// the live roster, writes "T/O" onto the dispatch Google Sheet, logs the
// request, and tells dispatch (Slack #asset + email).
//
//   GET          → { ok, requests }        the driver's last 10 requests
//   POST {start, end, note} → kpi's result (what was written / skipped)

import { NextRequest, NextResponse } from 'next/server'
import { DRIVER_COOKIE, kpiBaseUrl, parseDriverCookieValue } from '@/lib/driver-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const driver = parseDriverCookieValue(req.cookies.get(DRIVER_COOKIE)?.value)
  if (!driver) return NextResponse.json({ ok: false, error: 'not_logged_in' }, { status: 401 })
  try {
    const res = await fetch(`${kpiBaseUrl()}/api/driver-login/time-off?code=${encodeURIComponent(driver.code)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    const json = await res.json().catch(() => ({}))
    return NextResponse.json(json, { status: res.status })
  } catch {
    return NextResponse.json({ ok: false, error: 'kpi_unreachable' }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const driver = parseDriverCookieValue(req.cookies.get(DRIVER_COOKIE)?.value)
  if (!driver) return NextResponse.json({ ok: false, error: 'Please log in again.' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  try {
    const res = await fetch(`${kpiBaseUrl()}/api/driver-login/time-off`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // kpi rate-limits by caller IP; pass the driver's so one portal host
        // doesn't share a single bucket.
        'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
      },
      body: JSON.stringify({
        code: driver.code,
        start: String(body?.start ?? ''),
        end: String(body?.end ?? ''),
        note: String(body?.note ?? '').slice(0, 200),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(55000),
    })
    const json = await res.json().catch(() => ({}))
    return NextResponse.json(json, { status: res.status })
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach dispatch systems. Please call dispatch.' }, { status: 502 })
  }
}
