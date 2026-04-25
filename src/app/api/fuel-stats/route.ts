import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 10
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const blobUrl = process.env.FUEL_BLOB_URL
    if (!blobUrl) return NextResponse.json({ error: 'No blob URL' }, { status: 500 })

    const res = await fetch(blobUrl, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ error: 'Blob fetch failed' }, { status: 500 })

    const data = await res.json()
    const stations = data.stations as Array<{ state: string, yourPrice: number }>

    // Group by state, compute average Pilot price per state
    const byState: Record<string, { sum: number, count: number }> = {}
    for (const s of stations) {
      if (!s.state || !s.yourPrice) continue
      if (!byState[s.state]) byState[s.state] = { sum: 0, count: 0 }
      byState[s.state].sum += s.yourPrice
      byState[s.state].count += 1
    }

    const averages = Object.entries(byState)
      .filter(([_, v]) => v.count >= 3) // only states with 3+ stations for reliability
      .map(([state, v]) => ({ state, avgPrice: v.sum / v.count, count: v.count }))

    const sorted = [...averages].sort((a, b) => b.avgPrice - a.avgPrice)
    const highest = sorted.slice(0, 5)
    const lowest = [...averages].sort((a, b) => a.avgPrice - b.avgPrice).slice(0, 5)

    return NextResponse.json({ highest, lowest })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
