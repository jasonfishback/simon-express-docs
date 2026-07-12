// src/middleware.ts
//
// Driver-identity gate for the portal. The three driver-facing pages
// ('/', '/docs', '/fuel') require the sx_driver cookie (set once at /login,
// by a /d/<code> auto-login link, or by kpi's tokenized /fuel-plan page).
//
// The matcher is an ALLOWLIST of gated pages, not a denylist: /login,
// /d/<code>, the bare /<code> catch-all, /api/* and static assets are never
// touched, so no existing deep link, cron endpoint, or asset can be broken
// by the gate.
//
// On every gated view by a logged-in driver:
//   1. rolling refresh — the cookie is re-set for another 400 days, and
//   2. usage tracking — fire-and-forget POST to kpi's /api/driver-login/track
//      (waitUntil; kpi throttles storage to one row per driver+path+hour).

import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { DRIVER_COOKIE, kpiBaseUrl, parseDriverCookieValue } from '@/lib/driver-auth'
import { setDriverCookie } from '@/lib/driver-login-server'

export const config = {
  matcher: ['/', '/docs/:path*', '/fuel/:path*'],
}

export function middleware(req: NextRequest, event: NextFetchEvent) {
  const driver = parseDriverCookieValue(req.cookies.get(DRIVER_COOKIE)?.value)

  if (!driver) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    if (req.nextUrl.pathname !== '/') url.searchParams.set('next', req.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  const res = NextResponse.next()
  setDriverCookie(res, req, driver) // rolling refresh

  // Usage tracking — never blocks or breaks the page.
  event.waitUntil(
    fetch(`${kpiBaseUrl()}/api/driver-login/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: driver.code, path: req.nextUrl.pathname }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {})
  )

  return res
}
