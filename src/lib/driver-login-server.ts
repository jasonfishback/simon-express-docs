// src/lib/driver-login-server.ts
//
// Server-only halves of driver login: roster validation (against the kpi
// app, with the local FUEL_RECIPIENTS list as an outage fallback) and the
// shared auto-login handler used by /d/[code] and the bare /[code] catch-all.

import { NextRequest, NextResponse } from 'next/server'
import {
  DRIVER_COOKIE,
  DRIVER_COOKIE_MAX_AGE_S,
  cookieDomainForHost,
  kpiBaseUrl,
  normalizeDriverCode,
  serializeDriverCookieValue,
  type DriverIdentity,
} from './driver-auth'
import { FUEL_RECIPIENTS } from './recipients'

export type ValidateResult =
  | { ok: true; driver: DriverIdentity }
  | { ok: false; reason: 'invalid' | 'unavailable' }

/**
 * Validate a driver code against the kpi roster
 * (GET /api/driver-login/validate — driver_profiles, terminated excluded,
 * rate-limited by IP on the kpi side). `path` is recorded there as the login
 * event for usage tracking. If kpi is unreachable, fall back to the local
 * FUEL_RECIPIENTS list so a kpi outage can't lock every driver out.
 */
export async function validateDriverCode(rawCode: string, path: string): Promise<ValidateResult> {
  const code = normalizeDriverCode(rawCode)
  if (!code) return { ok: false, reason: 'invalid' }

  try {
    const url = `${kpiBaseUrl()}/api/driver-login/validate?code=${encodeURIComponent(code)}&path=${encodeURIComponent(path)}`
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const j = (await res.json()) as { ok?: boolean; code?: string; name?: string | null }
      if (j.ok && j.code) return { ok: true, driver: { code: j.code, name: j.name || null } }
      return { ok: false, reason: 'invalid' }
    }
    if (res.status === 429) return { ok: false, reason: 'unavailable' }
    // 5xx etc → try the local fallback below.
  } catch {
    // network error → local fallback
  }

  const local = FUEL_RECIPIENTS.find(
    (r) => r.driverCode && r.driverCode.toUpperCase() === code
  )
  if (local) return { ok: true, driver: { code, name: local.first } }
  return { ok: false, reason: 'unavailable' }
}

/** Attach the identity cookie to a response (shared attrs everywhere). */
export function setDriverCookie(res: NextResponse, req: NextRequest, driver: DriverIdentity): void {
  res.cookies.set(DRIVER_COOKIE, serializeDriverCookieValue(driver.code, driver.name), {
    maxAge: DRIVER_COOKIE_MAX_AGE_S,
    path: '/',
    sameSite: 'lax',
    httpOnly: false, // client JS reads it (badge, fuel current-load default)
    secure: req.nextUrl.protocol === 'https:',
    domain: cookieDomainForHost(req.headers.get('host') || req.nextUrl.hostname),
  })
}

/**
 * Auto-login link handler: docs.simonexpress.com/d/<code> (and the bare
 * /<code> fallback). Case-insensitive. Valid code → set cookie → home.
 * Anything else → the login screen with a friendly error.
 */
export async function handleAutoLogin(req: NextRequest, rawCode: string): Promise<NextResponse> {
  const result = await validateDriverCode(rawCode, '/d')
  if (!result.ok) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('e', result.reason === 'unavailable' ? 'retry' : 'code')
    return NextResponse.redirect(url)
  }
  const url = req.nextUrl.clone()
  url.pathname = '/'
  url.search = ''
  const res = NextResponse.redirect(url)
  setDriverCookie(res, req, result.driver)
  return res
}
