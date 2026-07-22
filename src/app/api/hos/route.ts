// src/app/api/hos/route.ts
//
// Hours-of-service clocks for the logged-in driver, for the fuel page's
// "Help me plan my hours & stops" panel. Same posture as /api/fuel-run:
// identity comes ONLY from the sx_driver cookie, forwards to kpi's public
// roster-gated /api/driver-login/hos, and always answers 200 so a kpi
// hiccup can never break the fuel page.

import { NextRequest, NextResponse } from 'next/server'
import { DRIVER_COOKIE, kpiBaseUrl, parseDriverCookieValue } from '@/lib/driver-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const driver = parseDriverCookieValue(req.cookies.get(DRIVER_COOKIE)?.value)
  if (!driver) return NextResponse.json({ ok: true, hos: null })

  try {
    const r = await fetch(`${kpiBaseUrl()}/api/driver-login/hos?code=${encodeURIComponent(driver.code)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
    if (r.ok) {
      const j = await r.json().catch(() => null)
      if (j && typeof j === 'object') return NextResponse.json({ ok: true, hos: j.hos ?? null })
    }
  } catch {
    // best-effort — the panel shows its "check your ELD" empty state
  }
  return NextResponse.json({ ok: true, hos: null })
}
