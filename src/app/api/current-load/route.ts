// src/app/api/current-load/route.ts
//
// "What load am I on?" for the fuel page's default route. Reads the driver
// identity from the sx_driver cookie (never from a query param — the page
// can only ask about the logged-in driver) and proxies kpi's
// /api/driver-login/current-load, which reuses the fuel check-in cron's
// candidate logic (most recent started asset load within 14 days).
//
// GET → 200 { ok: true, load: { order_num, origin, destination, ship_date,
//                               delivery_date, customer } }
//     → 200 { ok: true, none: true }   (no cookie, no load, or kpi down —
//                                       the fuel page just shows manual entry)

import { NextRequest, NextResponse } from 'next/server'
import { DRIVER_COOKIE, kpiBaseUrl, parseDriverCookieValue } from '@/lib/driver-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const driver = parseDriverCookieValue(req.cookies.get(DRIVER_COOKIE)?.value)
  if (!driver) return NextResponse.json({ ok: true, none: true })

  try {
    const url = `${kpiBaseUrl()}/api/driver-login/current-load?code=${encodeURIComponent(driver.code)}`
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!res.ok) return NextResponse.json({ ok: true, none: true })
    const j = await res.json()
    if (j?.ok && j.load?.order_num) return NextResponse.json({ ok: true, load: j.load })
  } catch {
    // fall through — manual entry still works
  }
  return NextResponse.json({ ok: true, none: true })
}
