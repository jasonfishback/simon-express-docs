import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

// POST: receive fuel data and save to Vercel Blob storage
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.apiKey !== process.env.FUEL_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { stations, updatedAt } = body

    if (!stations || !Array.isArray(stations) || stations.length === 0) {
      return NextResponse.json({ error: 'No stations provided' }, { status: 400 })
    }

    const fuelData = {
      updatedAt: updatedAt || new Date().toISOString().split('T')[0],
      stations,
    }

    // Save to Vercel Blob — public readable, addRandomSuffix false so URL is stable
    const blob = await put('fuel-data.json', JSON.stringify(fuelData), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
      allowOverwrite: true,
    })

    console.log(`Fuel data uploaded: ${stations.length} stations, URL: ${blob.url}`)
    return NextResponse.json({
      success: true,
      count: stations.length,
      updatedAt: fuelData.updatedAt,
      blobUrl: blob.url,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Fuel upload error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET: return the current data status
export async function GET() {
  try {
    const blobUrl = process.env.FUEL_BLOB_URL
    if (!blobUrl) {
      return NextResponse.json({ updatedAt: null, stationCount: 0, error: 'FUEL_BLOB_URL not set' })
    }
    const response = await fetch(blobUrl, { cache: 'no-store' })
    if (!response.ok) {
      return NextResponse.json({ updatedAt: null, stationCount: 0 })
    }
    const data = await response.json()
    return NextResponse.json({
      updatedAt: data.updatedAt,
      stationCount: data.stations?.length ?? 0,
    })
  } catch {
    return NextResponse.json({ updatedAt: null, stationCount: 0 })
  }
}
