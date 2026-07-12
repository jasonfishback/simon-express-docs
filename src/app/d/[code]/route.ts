// src/app/d/[code]/route.ts
//
// Personalized auto-login link: docs.simonexpress.com/d/<drivercode>
// (case-insensitive). This is the link appended to driver SMS from kpi
// (fuel check-in openers) — one tap validates the code against the roster,
// sets the identity cookie, and lands on the portal home. Invalid codes
// bounce to /login with a friendly error. The /d/ prefix is the canonical
// form (collision-proof with real routes); a bare /<code> fallback also
// exists (src/app/[code]/route.ts).

import { NextRequest } from 'next/server'
import { handleAutoLogin } from '@/lib/driver-login-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  return handleAutoLogin(req, params.code)
}
