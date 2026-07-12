// src/app/[code]/route.ts
//
// Bare auto-login fallback: docs.simonexpress.com/<drivercode> behaves like
// /d/<drivercode>. Safe to ship because Next.js gives static routes
// precedence over this dynamic segment — '/', '/docs', '/fuel', '/login',
// '/d/*' and '/api/*' are all matched first, and files in public/ are
// served before routing — so the only requests that land here are paths
// that would previously have 404'd. Those now redirect to /login (with the
// cookie set first when the path is a valid driver code). If a future
// top-level route is added, it will simply shadow this again — prefer the
// /d/ prefix in anything you send out.

import { NextRequest } from 'next/server'
import { handleAutoLogin } from '@/lib/driver-login-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  return handleAutoLogin(req, params.code)
}
