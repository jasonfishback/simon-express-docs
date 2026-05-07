import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { enrichStations } from '@/lib/fuel/enrich'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

/**
 * One-shot endpoint to rebuild fuel-data.json by re-applying the coord cache
 * to whatever pricing data is already in the blob.
 *
 * Use case: the coord cache (station-coords.json) was just updated with corrected
 * Geocodio values, but no new Pilot email is available to trigger a fresh ingest.
 * This route reads the current blob, strips lat/lng/address, runs enrichStations
 * to attach the new (correct) coords, and writes the result back.
 *
 * Auth: same INGEST_API_KEY as /api/fuel-ingest. Pass via ?key= or Bearer header.
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INGEST_API_KEY
  if (!secret) return false
  const auth = req.headers.get('authorization')
  if (auth === `Bearer ${secret}`) return true
  const keyParam = req.nextUrl.searchParams.get('key')
  if (keyParam === secret) return true
  return false
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const blobUrl = process.env.FUEL_BLOB_URL
  if (!blobUrl) {
    return NextResponse.json({ error: 'FUEL_BLOB_URL not set' }, { status: 500 })
  }

  // Read current blob
  const res = await fetch(blobUrl, { cache: 'no-store' })
  if (!res.ok) {
    return NextResponse.json({ error: `Failed to fetch blob (HTTP ${res.status})` }, { status: 500 })
  }
  const data = await res.json()

  if (!data.stations || !Array.isArray(data.stations)) {
    return NextResponse.json({ error: 'Existing blob has no stations array' }, { status: 500 })
  }

  // Reduce each station to just the pricing fields enrichStations expects.
  // Anything else (old/wrong lat/lng, address, zip, phone, name) gets thrown out
  // and re-applied from the current station-coords.json.
  const pricingRows = data.stations.map((s: any) => ({
    site: String(s.site),
    city: String(s.city),
    state: String(s.state),
    retailPrice: Number(s.retailPrice ?? s.yourPrice ?? 0),
    yourPrice: Number(s.yourPrice ?? 0),
    savings: Number(s.savings ?? 0),
  }))

  const { stations: enriched, cacheHits, cacheMisses } = enrichStations(pricingRows)

  // Write back to blob
  const newBlob = {
    updatedAt: data.updatedAt,
    stations: enriched,
  }
  const blob = await put('fuel-data.json', JSON.stringify(newBlob), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    allowOverwrite: true,
  })

  return NextResponse.json({
    success: true,
    rebuiltCount: enriched.length,
    cacheHits,
    cacheMisses: cacheMisses.length,
    cacheMissKeys: cacheMisses.slice(0, 20),
    updatedAt: newBlob.updatedAt,
    blobUrl: blob.url,
  })
}
