// src/lib/driver-auth.ts
//
// Driver identification for the portal. Drivers "log in" with their McLeod
// driver code — no password, by explicit design: this is lightweight
// identification for an internal tool, and the codes are validated against
// the live roster in the kpi app (GET kpi.simonexpress.com/api/driver-login/
// validate). The identity lives in a long-lived non-httpOnly cookie that the
// middleware refreshes on every visit, so a driver logs in once, ever.
//
// MIRRORED FORMAT: the kpi repo's lib/driver-site/portal.ts implements the
// exact same cookie name + value encoding (the tokenized /fuel-plan page on
// kpi sets this cookie with Domain=.simonexpress.com so an SMS plan click
// also logs the driver in here). Keep the two in sync:
//   cookie name   sx_driver
//   cookie value  <CODE>.<base64url(first name)>   (cookie-safe, no % escapes)
//
// Everything in this file is edge-safe and browser-safe (btoa/atob are
// global in browsers, edge runtime, and node 18+) so the middleware, route
// handlers, and client components can all import it.

export const DRIVER_COOKIE = 'sx_driver'

/** 400 days — the browser cap. Middleware re-sets the cookie on every gated
 * page view (rolling refresh), so active drivers never see the login screen
 * again. */
export const DRIVER_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60

export interface DriverIdentity {
  /** Canonical (uppercase) driver code, e.g. 'SUNTH'. */
  code: string
  /** First name for the "Logged in as" badge. */
  name: string | null
}

/** Base URL of the kpi app that owns the roster + usage tracking. */
export function kpiBaseUrl(): string {
  return (process.env.KPI_API_URL || 'https://kpi.simonexpress.com').replace(/\/+$/, '')
}

/**
 * Normalize a typed/linked driver code: trim, uppercase, 2–16 alphanumerics.
 * Null for anything else (also the injection/enumeration guard).
 */
export function normalizeDriverCode(raw: string | null | undefined): string | null {
  if (!raw) return null
  const code = raw.trim().toUpperCase()
  return /^[A-Z0-9]{2,16}$/.test(code) ? code : null
}

// ── base64url (cookie-safe name encoding) ────────────────────────────────────

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

// ── Cookie value (format shared with kpi — see header) ──────────────────────

export function serializeDriverCookieValue(code: string, name: string | null): string {
  const canonical = normalizeDriverCode(code)
  if (!canonical) throw new Error(`serializeDriverCookieValue: bad code ${JSON.stringify(code)}`)
  const trimmed = (name || '').trim()
  return trimmed ? `${canonical}.${b64urlEncode(trimmed)}` : canonical
}

export function parseDriverCookieValue(raw: string | null | undefined): DriverIdentity | null {
  if (!raw) return null
  const dot = raw.indexOf('.')
  const codePart = dot === -1 ? raw : raw.slice(0, dot)
  const code = normalizeDriverCode(codePart)
  if (!code) return null
  const name = dot === -1 ? null : b64urlDecode(raw.slice(dot + 1))
  return { code, name: name && name.trim() ? name.trim() : null }
}

/**
 * Cookie Domain attribute for a request host: '.simonexpress.com' in
 * production so the cookie is shared with kpi.simonexpress.com (whose
 * /fuel-plan page sets the same cookie); host-only elsewhere (localhost,
 * vercel previews).
 */
export function cookieDomainForHost(host: string | null | undefined): string | undefined {
  const h = (host || '').split(':')[0].toLowerCase()
  return h === 'simonexpress.com' || h.endsWith('.simonexpress.com') ? '.simonexpress.com' : undefined
}

// ── Browser-side helpers (client components) ─────────────────────────────────

/** Read the driver identity from document.cookie. Null when logged out. */
export function getDriverFromDocumentCookie(): DriverIdentity | null {
  if (typeof document === 'undefined') return null
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === DRIVER_COOKIE) {
      const parsed = parseDriverCookieValue(rest.join('='))
      if (parsed) return parsed
    }
  }
  return null
}

/**
 * Clear the identity cookie ("switch driver"). Clears BOTH the host-only and
 * the .simonexpress.com-domain variants — either writer may have set it.
 */
export function clearDriverCookie(): void {
  if (typeof document === 'undefined') return
  const expired = `${DRIVER_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`
  document.cookie = expired
  const domain = cookieDomainForHost(window.location.hostname)
  if (domain) document.cookie = `${expired}; Domain=${domain}`
}
