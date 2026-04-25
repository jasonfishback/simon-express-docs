import { NextRequest, NextResponse } from 'next/server'
import { lookupRecipients } from '@/lib/recipients'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const input = searchParams.get('q')
    if (!input) {
      return NextResponse.json({ error: 'Missing q parameter' }, { status: 400 })
    }

    const matches = lookupRecipients(input)

    if (matches.length === 0) {
      return NextResponse.json({ found: false, matches: [] })
    }

    return NextResponse.json({
      found: true,
      matches: matches.map(m => ({
        first: m.first,
        last: m.last,
        handle: m.handle,
        email: m.email,
        truckNumber: m.truckNumber,
        driverCode: m.driverCode,
      })),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
