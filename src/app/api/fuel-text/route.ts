// src/app/api/fuel-text/route.ts
//
// TEXT the current fuel plan to a driver (Jason 9/23/26: "should be able to
// text plans too - not just email"). Forwards the plan + recipient to kpi's
// /api/driver-login/fuel-plan-text, which resolves the recipient against the
// live roster (code / truck # / phone / email / name), saves the plan as the
// driver's plan-of-record, and sends the Bruno-format SMS with the tokenized
// plan link. The logged-in driver code (sx_driver cookie) rides along for
// attribution only — the recipient is whoever `to` resolves to.

import { NextRequest, NextResponse } from 'next/server'
import { DRIVER_COOKIE, kpiBaseUrl, parseDriverCookieValue } from '@/lib/driver-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const driver = parseDriverCookieValue(req.cookies.get(DRIVER_COOKIE)?.value)
  const body = await req.json().catch(() => ({}))
  if (!body?.to || !Array.isArray(body?.stops) || body.stops.length === 0) {
    return NextResponse.json({ ok: false, error: 'Missing recipient or plan' }, { status: 400 })
  }
  try {
    const res = await fetch(`${kpiBaseUrl()}/api/driver-login/fuel-plan-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, code: driver?.code ?? null }),
      signal: AbortSignal.timeout(25000),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json?.ok) {
      const map: Record<string, string> = {
        no_driver: 'No active driver matches that truck #, code, or phone.',
        no_phone: 'That driver has no phone number on file.',
        no_plan: 'No fuel stops to send.',
        rate_limited: 'Too many texts — try again in a few minutes.',
        send_failed: 'Text failed to send.',
      }
      return NextResponse.json({ ok: false, error: map[json?.error] || json?.error || 'Text failed' }, { status: 200 })
    }
    return NextResponse.json({ ok: true, to: json.to })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Text failed' }, { status: 200 })
  }
}
