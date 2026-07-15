import stationCoords from './station-coords.json'
import lovesCoords from './loves-coords.json'
import taCoords from './ta-coords.json'
import { STATE_CENTERS, US_CENTER } from './state-centers'
import type { FuelBrand, ParsedStation } from './parse'

interface CoordEntry {
  lat: number
  lng: number
  address: string
  zip: string
  phone: string
  /** TA cache carries the official pretty name ("TA Tuscaloosa"). */
  name?: string
}

// Per-brand coordinate caches, keyed `${site}|${state}`. All built from the
// chains' official location data: station-coords.json from Pilot's location
// file, loves-coords.json from loves.com/api/fetch_stores, ta-coords.json
// from ta-petro.com's published location-master xlsx (7/15/26 pulls).
const COORDS: Record<FuelBrand, Record<string, CoordEntry>> = {
  pfj: stationCoords as Record<string, CoordEntry>,
  loves: lovesCoords as Record<string, CoordEntry>,
  ta: taCoords as Record<string, CoordEntry>,
}

const DEFAULT_NAME: Record<FuelBrand, string> = {
  pfj: 'Pilot Travel Center',
  loves: "Love's Travel Stop",
  ta: 'TA Travel Center',
}

/** Kept as an alias — pre-multibrand callers imported this name. */
export type PricedStation = ParsedStation

export interface EnrichedStation extends ParsedStation {
  name: string
  address: string
  zip: string
  phone: string
  lat: number
  lng: number
}

export interface EnrichResult {
  stations: EnrichedStation[]
  cacheHits: number
  cacheMisses: string[] // "brand:site|state" keys that had no cached coords
}

/**
 * Join parsed pricing rows with cached station coordinates (per brand).
 *
 * PFJ keeps its historical fallback (state center, then US center) so the
 * station count never drops below the priced list. Love's/TA rows with no
 * cache entry are EXCLUDED instead — a state-center coordinate would let the
 * route planner match a station hundreds of miles from its real location,
 * which is worse than not offering it. Misses are reported so the coord
 * caches can be refreshed from the locator sources.
 */
export function enrichStations(rows: ParsedStation[]): EnrichResult {
  const stations: EnrichedStation[] = []
  const misses: string[] = []
  let hits = 0

  for (const r of rows) {
    const brand: FuelBrand = r.brand || 'pfj'
    const key = `${r.site}|${r.state}`
    const cached = COORDS[brand][key]

    if (cached) {
      hits++
      stations.push({
        ...r,
        brand,
        name: cached.name || r.name || DEFAULT_NAME[brand],
        address: cached.address,
        zip: cached.zip,
        phone: cached.phone,
        lat: Math.round(cached.lat * 10000) / 10000,
        lng: Math.round(cached.lng * 10000) / 10000,
      })
      continue
    }

    misses.push(`${brand}:${key}`)
    if (brand !== 'pfj') continue

    const center = STATE_CENTERS[r.state] || US_CENTER
    stations.push({
      ...r,
      brand,
      name: r.name || DEFAULT_NAME[brand],
      address: '',
      zip: '',
      phone: '',
      lat: Math.round(center[0] * 10000) / 10000,
      lng: Math.round(center[1] * 10000) / 10000,
    })
  }

  return { stations, cacheHits: hits, cacheMisses: misses }
}
