// Recipients for personalized fuel plan emails / texts.
//
// 9/23/26: DRIVERS come from the LIVE roster in kpi (driver_profiles + the
// truck each one is paired to) via GET kpi/api/driver-login/recipient — the
// old hand-typed list here went stale (Dennis Carlton/CARD missing, truck 24
// still on Howard Gilory, terminated). Only OFFICE staff (no driver code)
// stay hard-coded below, for email-only sends and greeting handles.
// Lookup supports: email, phone, truck number, driver code, or name.

import { kpiBaseUrl } from '@/lib/driver-auth'

export interface Recipient {
  first: string
  last: string
  handle?: string | null
  email: string
  phone?: string | null
  truckNumber?: number | null
  driverCode?: string | null
}

/** Office staff (email only). Drivers are resolved live from kpi. */
export const STAFF_RECIPIENTS: Recipient[] = [
  { first: 'Jaden',   last: 'Simon',       handle: null,       email: 'jsimon@simonexpress.com',   truckNumber: null, driverCode: null },
  { first: 'Rusty',   last: 'Fullmer',     handle: 'Roosty',   email: 'rfullmer@simonexpress.com', truckNumber: null, driverCode: null },
  { first: 'Jaxon',   last: 'Simon',       handle: null,       email: 'jax@simonexpress.com',      truckNumber: null, driverCode: null },
  { first: 'Cameron', last: 'Perkins',     handle: null,       email: 'cperkins@simonexpress.com', truckNumber: null, driverCode: null },
  { first: 'Jordan',  last: 'Simon',       handle: 'Choncho',  email: 'jordan@simonexpress.com',   truckNumber: null, driverCode: null },
  { first: 'Ethan',   last: 'Fishback',    handle: null,       email: 'efishback@simonexpress.com', truckNumber: null, driverCode: null },
  { first: 'Chas',    last: 'Simon',       handle: null,       email: 'csimon@simonexpress.com',   truckNumber: null, driverCode: null },
  { first: 'TeJay',   last: 'Simon',       handle: null,       email: 'tsimon@simonexpress.com',   truckNumber: null, driverCode: null },
  { first: 'Jason',   last: 'Fishback',    handle: 'Fish',     email: 'jfishback@simonexpress.com', truckNumber: null, driverCode: null },
]

/** Driver "handles" (nicknames) used in greetings — keyed by driver code. */
const DRIVER_HANDLES: Record<string, string> = {
  SUNTH: 'swampdog',
  FRIK: 'Fritter',
  RUSTROCA: 'Needle Bender 9250',
}

/** Backwards-compatible alias (some code still imports FUEL_RECIPIENTS). */
export const FUEL_RECIPIENTS: Recipient[] = STAFF_RECIPIENTS

function staffByEmail(email: string): Recipient | null {
  const normalized = email.trim().toLowerCase()
  return STAFF_RECIPIENTS.find(r => r.email.toLowerCase() === normalized) || null
}

/** Sync, staff-only email match (kept for callers that can't await). */
export function findRecipient(email: string): Recipient | null {
  return staffByEmail(email)
}

interface KpiMatch {
  code: string
  first: string | null
  last: string | null
  email: string | null
  phone: string | null
  truck: string | null
}

async function kpiLookup(q: string): Promise<Recipient[]> {
  try {
    const res = await fetch(`${kpiBaseUrl()}/api/driver-login/recipient?q=${encodeURIComponent(q)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const json = await res.json().catch(() => null)
    const matches: KpiMatch[] = Array.isArray(json?.matches) ? json.matches : []
    return matches.map(m => ({
      first: m.first || m.code,
      last: m.last || '',
      handle: DRIVER_HANDLES[m.code] ?? null,
      email: (m.email || '').trim(),
      phone: m.phone ?? null,
      truckNumber: m.truck && /^\d+$/.test(m.truck) ? parseInt(m.truck, 10) : null,
      driverCode: m.code,
    }))
  } catch {
    return []
  }
}

/** Email → recipient (staff list first, then the live driver roster). */
export async function findRecipientAsync(email: string): Promise<Recipient | null> {
  const staff = staffByEmail(email)
  if (staff) return staff
  const live = await kpiLookup(email.trim())
  return live[0] ?? null
}

/**
 * Look up recipients by input — email, phone, truck number, driver code, or
 * name. Staff match by email; everything else resolves against the live
 * driver roster in kpi. Returns matching recipients (empty if none).
 */
export async function lookupRecipients(input: string): Promise<Recipient[]> {
  const trimmed = input.trim()
  if (!trimmed) return []
  if (trimmed.includes('@')) {
    const staff = staffByEmail(trimmed)
    if (staff) return [staff]
  }
  const live = await kpiLookup(trimmed)
  if (live.length) return live
  // Staff by name as a last resort ("tejay").
  const needle = trimmed.toLowerCase()
  if (needle.length >= 3 && !/^\d+$/.test(needle)) {
    return STAFF_RECIPIENTS.filter(r => `${r.first} ${r.last}`.toLowerCase().includes(needle))
  }
  return []
}

/** Time-of-day greeting for the email/text body. */
export function getTimeOfDayGreeting(tz: string = 'America/Denver'): string {
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()), 10)
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function getTodaysDateFormatted(tz: string = 'America/Denver'): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())
}
