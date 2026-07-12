// src/app/api/login/route.ts
//
// Login-screen submit: validate the typed driver code against the kpi
// roster (src/lib/driver-login-server.ts — with local-roster fallback if
// kpi is down) and, on success, set the sx_driver identity cookie.
//
// POST { code: 'sunth' }
//   → 200 { ok: true, code: 'SUNTH', name: 'Thomas' }  + Set-Cookie
//   → 401 { ok: false, error: 'code' }     (unknown/terminated code)
//   → 503 { ok: false, error: 'retry' }    (roster unreachable / throttled)

import { NextRequest, NextResponse } from 'next/server'
import { validateDriverCode, setDriverCookie } from '@/lib/driver-login-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { code?: string }
  const result = await validateDriverCode(body.code || '', '/login')

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason === 'unavailable' ? 'retry' : 'code' },
      { status: result.reason === 'unavailable' ? 503 : 401 }
    )
  }

  const res = NextResponse.json({ ok: true, code: result.driver.code, name: result.driver.name })
  setDriverCookie(res, req, result.driver)
  return res
}
