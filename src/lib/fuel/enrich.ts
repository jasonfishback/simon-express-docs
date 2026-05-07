import stationCoords from './station-coords.json'
import { STATE_CENTERS, US_CENTER } from './state-centers'

interface CoordEntry {
  lat: number
  lng: number
  address: string
  zip: string
  phone: string
}

const COORDS = stationCoords as Record<string, CoordEntry>

export interface PricedStation {
  site: string
  city: string
  state: string
  retailPrice: number
  yourPrice: number
  savings: number
}

export interface EnrichedStation extends PricedStation {
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
  cacheMisses: string[] // list of "site|state" keys that fell back to state center
}

/**
 * Join parsed Pilot pricing rows with cached station coordinates.
 * Replaces the role the old Apps Script geocoder + Drive cache used to play.
 *
 * Lookup order per station:
 *   1. station-coords.json keyed by `${site}|${state}` (685 known Pilot locations)
 *   2. STATE_CENTERS fallback (rough but at least in the right state)
 *   3. US_CENTER if state is unrecognized
 *
 * Cache misses are logged and returned so we can see which sites need to be
 * added to station-coords.json over time.
 */
export function enrichStations(rows: PricedStation[]): EnrichResult {
  const stations: EnrichedStation[] = []
  const misses: string[] = []
  let hits = 0

  for (const r of rows) {
    const key = `${r.site}|${r.state}`
    const cached = COORDS[key]

    let lat: number, lng: number, address: string, zip: string, phone: string
    if (cached) {
      hits++
      lat = cached.lat
      lng = cached.lng
      address = cached.address
      zip = cached.zip
      phone = cached.phone
    } else {
      misses.push(key)
      const center = STATE_CENTERS[r.state] || US_CENTER
      lat = center[0]
      lng = center[1]
      address = ''
      zip = ''
      phone = ''
    }

    stations.push({
      ...r,
      name: 'Pilot Travel Center',
      address,
      zip,
      phone,
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round(lng * 10000) / 10000,
    })
  }

  return { stations, cacheHits: hits, cacheMisses: misses }
}
