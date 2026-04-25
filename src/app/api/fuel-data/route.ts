import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET: fetch fuel data from Vercel Blob and return it
// This proxies the blob so the frontend URL stays /api/fuel-data
export async function GET() {
  try {
    const blobUrl = process.env.FUEL_BLOB_URL
    if (!blobUrl) {
      return NextResponse.json(
        { error: 'FUEL_BLOB_URL environment variable not set' },
        { status: 500 }
      )
    }

    const response = await fetch(blobUrl, { cache: 'no-store' })
    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch fuel data: ${response.status}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Fuel data fetch error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
