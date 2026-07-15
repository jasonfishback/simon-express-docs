// src/app/api/fuel-run/route.ts
//
// Records that the logged-in driver ran a fuel route (and which stations the
// optimizer gave them) by forwarding to kpi's /api/driver-login/fuel-run.
// Same posture as /api/current-load: driver identity comes ONLY from the
// sx_driver cookie, never a body field, so a driver can only log their own
// runs. Fire-and-forget from the fuel page; always 200 so it never disrupts
// planning.

import { NextRequest, NextResponse } from 'next/server'
import { DRIVER_COOKIE, kpiBaseUrl, parseDriverCookieValue } from '@/lib/driver-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const driver = parseDriverCookieValue(req.cookies.get(DRIVER_COOKIE)?.value)
  if (!driver) return NextResponse.json({ ok: true }) // not logged in — nothing to log

  try {
    const body = await req.json().catch(() => ({}))
    await fetch(`${kpiBaseUrl()}/api/driver-login/fuel-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, code: driver.code }),
      signal: AbortSignal.timeout(6000),
    })
  } catch {
    // best-effort — never disrupt the fuel page
  }
  return NextResponse.json({ ok: true })
}
