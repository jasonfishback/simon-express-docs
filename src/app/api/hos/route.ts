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
export const maxDuration = 30

// kpi serves recap nights from a nightly cache (fast), but falls back to a
// live ~10s SOAP page when a driver has no cache row yet. 6s (the fuel-run
// default) silently aborted every one of those, so the panel always showed
// its empty state — give the fallback room to answer.
const KPI_TIMEOUT_MS = 20_000

export async function GET(req: NextRequest) {
  const driver = parseDriverCookieValue(req.cookies.get(DRIVER_COOKIE)?.value)
  if (!driver) return NextResponse.json({ ok: true, hos: null })

  try {
    const r = await fetch(`${kpiBaseUrl()}/api/driver-login/hos?code=${encodeURIComponent(driver.code)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(KPI_TIMEOUT_MS),
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
