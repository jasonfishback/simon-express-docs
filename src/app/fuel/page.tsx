'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import stationAmenities from '../../data/station-amenities.json'

interface Station {
  site: string
  city: string
  state: string
  yourPrice: number
  savings: number
  lat: number
  lng: number
  name?: string
  address?: string
  zip?: string
  phone?: string
  // Rich metadata from Pilot_FJ_Locations.xlsx
  description?: string      // e.g. "Flying J", "Pilot Travel Center"
  interstate?: string       // e.g. "I-65 & SR 94  Exit 264"
  parking?: number          // Truck parking spaces
  dieselLanes?: number
  dieselDefLanes?: number
  showers?: number
  catScale?: boolean
  facilities?: string       // e.g. "Subway, Cinnabon, Breakfast/Soup Bar"
}

interface FuelData {
  updatedAt: string
  stations: Station[]
}

const STATE_LIST = [
  'AL','AR','AZ','CA','CO','CT','FL','GA','IA','ID','IL','IN','KS','KY','LA',
  'MA','MD','MI','MN','MO','MS','MT','NC','ND','NE','NJ','NM','NV','NY','OH',
  'OK','OR','PA','SC','SD','TN','TX','UT','VA','WA','WI','WV','WY'
]

type ViewMode = 'all' | 'route'

/**
 * Build a Google Maps URL that routes to the ACTUAL STREET ADDRESS of a station.
 * Google Maps geocodes the address text and plots driving directions to that specific building,
 * not just a pin at arbitrary coordinates. Falls back to lat/lng only if no address is available.
 */
function googleMapsUrl(s: { address?: string; city: string; state: string; zip?: string; lat: number; lng: number; description?: string }): string {
  if (s.address && s.address.trim()) {
    const parts = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', ')
    // Pass the full street address as the query. Google Maps will geocode to the exact address.
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts)}`
  }
  // No street address — fall back to coordinates with station label
  const label = (s.description || 'Pilot Travel Center') + ' ' + s.city + ', ' + s.state
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`
}

/**
 * Build an Apple Maps URL that routes to the street address.
 * Apple Maps' `address=` parameter geocodes the address text to a specific street location
 * (this is different from `ll=lat,lng` which only drops a pin at arbitrary coordinates).
 */
function appleMapsUrl(s: { address?: string; city: string; state: string; zip?: string; lat: number; lng: number; description?: string }): string {
  if (s.address && s.address.trim()) {
    const parts = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', ')
    return `https://maps.apple.com/?address=${encodeURIComponent(parts)}`
  }
  const label = (s.description || 'Pilot Travel Center') + ' ' + s.city + ', ' + s.state
  return `https://maps.apple.com/?q=${encodeURIComponent(label)}`
}

// Distance from a point to a line segment (in miles)
function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax, dy = by - ay
  if (dx === 0 && dy === 0) {
    return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2) * 69
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.sqrt((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) * 69
}

function distanceToRoute(station: Station, routePoints: {lat: number, lng: number}[]): number {
  let minDist = Infinity
  for (let i = 0; i < routePoints.length - 1; i++) {
    const d = pointToSegmentDist(
      station.lat, station.lng,
      routePoints[i].lat, routePoints[i].lng,
      routePoints[i + 1].lat, routePoints[i + 1].lng
    )
    if (d < minDist) minDist = d
  }
  return minDist
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export default function FuelPage() {
  const [data, setData] = useState<FuelData | null>(null)
  const [selectedState, setSelectedState] = useState<string>('ALL')
  const [selectedStation, setSelectedStation] = useState<Station | null>(null)
  const [expandedPlanStop, setExpandedPlanStop] = useState<number | null>(null)
  // Tracks stops that the driver chose to skip (because they'd rather fuel at the next, cheaper stop).
  // Stored as a Set of stop indices in the original plan that have been hidden.
  const [skippedStopIndices, setSkippedStopIndices] = useState<Set<number>>(new Set())
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null)
  const [closestStation, setClosestStation] = useState<Station | null>(null)
  const [locationSearch, setLocationSearch] = useState<string>('')
  const [searchCenter, setSearchCenter] = useState<{lat: number, lng: number, label: string} | null>(null)
  const locSearchRef = useRef<HTMLInputElement>(null)
  const locSearchAutoRef = useRef<any>(null)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState('')
  // colorMode is fixed to 'price' — your price (lowest per gallon) is always the most important
  // and we never want drivers to optimize for "savings" over actual cost.
  const colorMode: 'price' | 'savings' = 'price'
  const [mapLoaded, setMapLoaded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('route')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [viaPoints, setViaPoints] = useState<string[]>([])
  const [extraMilesFromVias, setExtraMilesFromVias] = useState<number>(0)
  const [isRoundTrip, setIsRoundTrip] = useState<boolean>(false)
  // Corridor distance is fixed at 10 miles. The optimizer can pick stations farther
  // off-route (up to 20mi if savings justify, or up to 50mi as a last resort).
  const corridorMiles = 10
  const [routeStations, setRouteStations] = useState<Station[]>([])
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [routeInfo, setRouteInfo] = useState<{distance: string, duration: string, miles: number} | null>(null)
  const [currentFuelEighths, setCurrentFuelEighths] = useState<number>(4) // 0-8, default 1/2 tank
  const [routeDistanceMap, setRouteDistanceMap] = useState<Map<string, number>>(new Map()) // station site -> miles from origin
  const [routeDetourMap, setRouteDetourMap] = useState<Map<string, number>>(new Map()) // station site -> detour miles (distance off the route)
  const [showOptimizer, setShowOptimizer] = useState<boolean>(true)
  const [optimizedPlan, setOptimizedPlan] = useState<Array<{station: Station, gallons: number, milesFromOrigin: number, cost: number, savings: number, detour?: number, resultsInFullTank?: boolean, fuelOnArrival?: number}> | null>(null)
  const [optimizerError, setOptimizerError] = useState<string>('')
  const [showEmailModal, setShowEmailModal] = useState<boolean>(false)
  const [emailAddress, setEmailAddress] = useState<string>('')
  const [emailSending, setEmailSending] = useState<boolean>(false)
  const [emailStatus, setEmailStatus] = useState<string>('')
  const [lookupMatches, setLookupMatches] = useState<Array<{first: string, last: string, handle: string|null, email: string, truckNumber: number|null, driverCode: string|null}>>([])
  const [lookupLoading, setLookupLoading] = useState<boolean>(false)
  const lookupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lookupSeqRef = useRef<number>(0)
  const [originLatLng, setOriginLatLng] = useState<{lat: number, lng: number} | null>(null)
  const [destLatLng, setDestLatLng] = useState<{lat: number, lng: number} | null>(null)
  const [routeAlerts, setRouteAlerts] = useState<Array<{severity: 'warning' | 'info', title: string, detail?: string}>>([])
  const [alertsLoading, setAlertsLoading] = useState<boolean>(false)
  const [routeExitInfo, setRouteExitInfo] = useState<Map<string, string>>(new Map())
  const [routeSummary, setRouteSummary] = useState<Array<{ road: string, miles: number, exitNote?: string }>>([])

  const mapRef = useRef<HTMLDivElement>(null)
  const googleMap = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const routeRendererRef = useRef<any>(null)
  const userMarkerRef = useRef<any>(null)
  const infoWindowRef = useRef<any>(null)
  const originRef = useRef<HTMLInputElement>(null)
  const destRef = useRef<HTMLInputElement>(null)
  const originAutoRef = useRef<any>(null)
  const destAutoRef = useRef<any>(null)
  const viaRefs = useRef<Array<HTMLInputElement | null>>([])
  const viaAutoRefs = useRef<Array<any>>([])

  useEffect(() => {
    // Helper: merge amenity data (from Pilot_FJ_Locations.xlsx) into each station by Store #
    const mergeAmenities = (json: FuelData): FuelData => {
      if (!json?.stations) return json
      const amenityMap = stationAmenities as Record<string, Partial<Station> & { city?: string, state?: string }>
      const enriched = json.stations.map(s => {
        // Extract store number from site (could be "PFJ #123" or just "123" or "044")
        const siteMatch = String(s.site).match(/(\d+)/)
        const storeNumRaw = siteMatch ? siteMatch[1] : null
        // Try both with and without leading zeros since the amenity JSON strips them
        const storeNum = storeNumRaw ? String(parseInt(storeNumRaw, 10)) : null
        const extra = storeNum ? (amenityMap[storeNum] || (storeNumRaw ? amenityMap[storeNumRaw] : null)) : null
        if (!extra) return s
        // Pilot's official location file is authoritative for city/state/address/zip/phone.
        // Override the uploaded data (which can have errors like "Rock Springs salt lake city").
        return {
          ...s,
          city: extra.city || s.city,
          state: extra.state || s.state,
          address: extra.address || s.address,
          zip: extra.zip || s.zip,
          phone: extra.phone || s.phone,
          description: s.description || extra.description,
          interstate: s.interstate || extra.interstate,
          parking: s.parking ?? extra.parking,
          dieselLanes: s.dieselLanes ?? extra.dieselLanes,
          dieselDefLanes: s.dieselDefLanes ?? extra.dieselDefLanes,
          showers: s.showers ?? extra.showers,
          catScale: s.catScale ?? extra.catScale,
          facilities: s.facilities || extra.facilities,
        }
      })
      return { ...json, stations: enriched }
    }
    // Try blob API first, fall back to bundled static file
    fetch('/api/fuel-data')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(json => {
        if (json?.stations?.length) { setData(mergeAmenities(json)) } else { return Promise.reject('empty') }
      })
      .catch(() => fetch('/fuel-data.json').then(r => r.json()).then(j => setData(mergeAmenities(j))).catch(console.error))
  }, [])

  // Set up Places autocomplete — supports both legacy and new Google Places API
  useEffect(() => {
    let attempts = 0
    const tryAttach = () => {
      const G = (window as any).google
      if (!G?.maps?.places) {
        if (attempts++ < 20) setTimeout(tryAttach, 300)
        return
      }

      const attachAutocomplete = (
        ref: React.RefObject<HTMLInputElement>,
        acRef: React.MutableRefObject<any>,
        setter: (v: string) => void
      ) => {
        if (!ref.current || acRef.current) return

        if (G.maps.places.AutocompleteSuggestion) {
          // New Places API (required for API keys created after March 2025)
          let sessionToken = new G.maps.places.AutocompleteSessionToken()
          let sugBox: HTMLDivElement | null = null

          const clearBox = () => { if (sugBox) { sugBox.remove(); sugBox = null } }

          ref.current.addEventListener('input', async () => {
            const val = ref.current?.value || ''
            if (val.length < 2) { clearBox(); return }
            try {
              const { suggestions } = await G.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
                input: val, sessionToken,
                includedPrimaryTypes: ['locality', 'administrative_area_level_3'],
                includedRegionCodes: ['us'],
              })
              clearBox()
              if (!suggestions?.length || !ref.current) return
              sugBox = document.createElement('div')
              const rect = ref.current.getBoundingClientRect()
              sugBox.style.cssText = `position:fixed;z-index:9999;background:#fff;border:1px solid #E6E7EA;border-radius:14px;box-shadow:0 4px 8px rgba(11,11,12,0.05),0 14px 28px rgba(11,11,12,0.12);width:${ref.current.offsetWidth}px;left:${rect.left}px;top:${rect.bottom + 4}px;overflow:hidden`
              document.body.appendChild(sugBox)
              suggestions.slice(0, 6).forEach((s: any) => {
                const pp = s.placePrediction
                const item = document.createElement('div')
                item.textContent = pp.text.toString()
                item.style.cssText = 'padding:11px 14px;cursor:pointer;font-size:14px;color:#17181A;border-bottom:1px solid #EFEFEC;font-family:Inter,sans-serif;transition:background 120ms'
                item.onmouseenter = () => { item.style.background = '#F2F2EE' }
                item.onmouseleave = () => { item.style.background = '#fff' }
                item.onmousedown = async (e) => {
                  e.preventDefault()
                  const place = pp.toPlace()
                  await place.fetchFields({ fields: ['displayName', 'formattedAddress'] })
                  const text = place.formattedAddress || place.displayName || pp.text.toString()
                  if (ref.current) ref.current.value = text
                  setter(text)
                  sessionToken = new G.maps.places.AutocompleteSessionToken()
                  clearBox()
                }
                sugBox!.appendChild(item)
              })
            } catch (e) {
              // Places API blocked — fall back to Geocoding API for city suggestions
              try {
                const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
                const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(val + ', USA')}&key=${apiKey}`)
                const data = await res.json()
                clearBox()
                if (!data.results?.length || !ref.current) return
                // Filter to city-level results
                const cities = data.results.filter((r: any) =>
                  r.types.some((t: string) => ['locality', 'sublocality', 'administrative_area_level_3', 'colloquial_area'].includes(t))
                ).slice(0, 6)
                if (!cities.length) return
                sugBox = document.createElement('div')
                const rect = ref.current.getBoundingClientRect()
                sugBox.style.cssText = `position:fixed;z-index:9999;background:#fff;border:1px solid #E6E7EA;border-radius:14px;box-shadow:0 4px 8px rgba(11,11,12,0.05),0 14px 28px rgba(11,11,12,0.12);width:${ref.current.offsetWidth}px;left:${rect.left}px;top:${rect.bottom + 4}px;overflow:hidden`
                document.body.appendChild(sugBox)
                cities.forEach((r: any) => {
                  const text = r.formatted_address
                  const item = document.createElement('div')
                  item.textContent = text
                  item.style.cssText = 'padding:11px 14px;cursor:pointer;font-size:14px;color:#17181A;border-bottom:1px solid #EFEFEC;font-family:Inter,sans-serif;transition:background 120ms'
                  item.onmouseenter = () => { item.style.background = '#F2F2EE' }
                  item.onmouseleave = () => { item.style.background = '#fff' }
                  item.onmousedown = (e) => {
                    e.preventDefault()
                    if (ref.current) ref.current.value = text
                    setter(text)
                    clearBox()
                  }
                  sugBox!.appendChild(item)
                })
              } catch (e2) { console.error('Geocoding fallback error:', e2) }
            }
          })
          ref.current.addEventListener('blur', () => setTimeout(clearBox, 200))
          acRef.current = { custom: true }

        } else if (G.maps.places.Autocomplete) {
          // Legacy Autocomplete widget
          acRef.current = new G.maps.places.Autocomplete(ref.current, {
            types: ['(cities)'],
            componentRestrictions: { country: 'us' },
            fields: ['formatted_address', 'geometry', 'name'],
          })
          acRef.current.addListener('place_changed', () => {
            const place = acRef.current.getPlace()
            if (place?.formatted_address) setter(place.formatted_address)
            else if (place?.name) setter(place.name)
          })
        }
      }
      attachAutocomplete(originRef, originAutoRef, setOrigin)
      attachAutocomplete(destRef, destAutoRef, setDestination)
      attachAutocomplete(locSearchRef, locSearchAutoRef, (val: string) => {
        setLocationSearch(val)
        // When user picks from autocomplete, geocode immediately
        const geocoder = new G.maps.Geocoder()
        geocoder.geocode({ address: val }, (res: any, status: any) => {
          if (status === 'OK' && res?.[0]) {
            const loc = res[0].geometry.location
            setSearchCenter({ lat: loc.lat(), lng: loc.lng(), label: val })
          }
        })
      })
      // Attach to each via-point input
      viaRefs.current.forEach((inp, idx) => {
        if (!inp) return
        // Use a wrapped ref object matching the same shape as originRef/destRef
        const wrapRef = { current: inp } as React.RefObject<HTMLInputElement>
        // Each via-point needs its own acRef slot to track attachment
        if (!viaAutoRefs.current[idx]) viaAutoRefs.current[idx] = { current: null }
        attachAutocomplete(
          wrapRef,
          viaAutoRefs.current[idx],
          (val: string) => {
            // Update the corresponding via-point in state
            setViaPoints(prev => {
              const next = [...prev]
              next[idx] = val
              return next
            })
          }
        )
      })
    }
    setTimeout(tryAttach, 500)
  }, [mapLoaded, viewMode, viaPoints.length])

  // Load Google Maps
  useEffect(() => {
    if (document.getElementById('gmaps-script')) {
      if ((window as any).google) setMapLoaded(true)
      return
    }
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    if (!apiKey) {
      console.error('NEXT_PUBLIC_GOOGLE_MAPS_KEY not set')
      return
    }
    const script = document.createElement('script')
    script.id = 'gmaps-script'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&v=weekly&callback=__gmaps_init`
    script.async = true
    script.defer = true
    ;(window as any).__gmaps_init = () => setMapLoaded(true)
    script.onerror = () => console.error('Google Maps failed to load — check API key and enabled APIs')
    document.head.appendChild(script)
  }, [])

  const filteredStations = data?.stations.filter(s => {
    if (viewMode === 'route') {
      // If optimizer is showing and has generated a plan, only show suggested stops
      if (showOptimizer && optimizedPlan && optimizedPlan.length > 0) {
        return optimizedPlan.some(stop => stop.station.site === s.site)
      }
      // Otherwise show all corridor stations
      return routeStations.some(r => r.site === s.site)
    }
    return selectedState === 'ALL' || s.state === selectedState
  }) ?? []

  // Haversine distance in miles between two lat/lng pairs
  const milesBetween = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 3958.8 // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2) ** 2
    return 2 * R * Math.asin(Math.sqrt(a))
  }

  // If a location search is active (and we're in "all" view), compute per-station distances
  // and sort by distance. Returns a list of stations with an extra `distanceMi` property.
  const stationsWithDistance = (searchCenter && viewMode === 'all')
    ? filteredStations
        .map(s => ({ ...s, distanceMi: milesBetween(searchCenter.lat, searchCenter.lng, s.lat, s.lng) }))
        .sort((a, b) => a.distanceMi - b.distanceMi)
    : null

  // "Best price from nearest 5" helper — when searchCenter is active
  const bestOfNearest5 = stationsWithDistance
    ? [...stationsWithDistance.slice(0, 5)].sort((a, b) => a.yourPrice - b.yourPrice)[0]
    : null

  const getMarkerColor = useCallback((station: Station, stations: Station[]) => {
    const prices = stations.map(s => s.yourPrice)
    const savings = stations.map(s => s.savings)
    const minP = Math.min(...prices), maxP = Math.max(...prices)
    const minS = Math.min(...savings), maxS = Math.max(...savings)
    const pRange = maxP - minP || 1
    const sRange = maxS - minS || 1

    if (colorMode === 'price') {
      const t = (station.yourPrice - minP) / pRange
      if (t < 0.33) return '#16a34a'
      if (t < 0.66) return '#ca8a04'
      return '#dc2626'
    } else {
      const t = (station.savings - minS) / sRange
      if (t > 0.66) return '#16a34a'
      if (t > 0.33) return '#ca8a04'
      return '#dc2626'
    }
  }, [colorMode])

  // Init and update map
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !data) return
    const G = (window as any).google
    if (!G) return

    if (!googleMap.current) {
      googleMap.current = new G.maps.Map(mapRef.current, {
        center: { lat: 39.5, lng: -98.35 },
        zoom: 4,
        mapTypeId: 'roadmap',
        styles: [
          { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        ],
        fullscreenControl: false,
      })
      infoWindowRef.current = new G.maps.InfoWindow()
    }

    // Clear existing markers
    markersRef.current.forEach(m => m.setMap(null))
    markersRef.current = []

    const stations = filteredStations

    stations.forEach(station => {
      const color = getMarkerColor(station, stations)
      const marker = new G.maps.Marker({
        position: { lat: station.lat, lng: station.lng },
        map: googleMap.current,
        icon: {
          path: G.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
        },
        title: `Pilot Travel Center\n${station.city}, ${station.state} — $${station.yourPrice.toFixed(2)}`,
      })

      marker.addListener('click', () => {
        setSelectedStation(station)
        // Auto-filter station list to this station's state (only in 'all' view)
        if (viewMode === 'all' && selectedState === 'ALL') {
          setSelectedState(station.state)
        }
        googleMap.current.panTo({ lat: station.lat, lng: station.lng })
      })

      markersRef.current.push(marker)
    })

    // Fit bounds to stations only when in 'all' view with a state filter
    // (In 'route' view, the DirectionsRenderer already handles the correct bounds for the route)
    if (stations.length > 0 && selectedState !== 'ALL' && viewMode === 'all') {
      const bounds = new G.maps.LatLngBounds()
      stations.forEach(s => bounds.extend({ lat: s.lat, lng: s.lng }))
      googleMap.current.fitBounds(bounds, { padding: 40 })
    }
  }, [mapLoaded, data, filteredStations, colorMode, selectedState, viewMode, getMarkerColor])

  // User location marker
  useEffect(() => {
    if (!mapLoaded || !userLocation || !googleMap.current) return
    const G = (window as any).google
    if (!G) return
    if (userMarkerRef.current) userMarkerRef.current.setMap(null)
    userMarkerRef.current = new G.maps.Marker({
      position: userLocation,
      map: googleMap.current,
      icon: {
        path: G.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: '#1d4ed8',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
      title: 'Your Location',
      zIndex: 999,
    })
    googleMap.current.panTo(userLocation)
  }, [userLocation, mapLoaded])

  // Pan/zoom to the location search target — show ~150 mile radius around the searched city
  useEffect(() => {
    if (!mapLoaded || !searchCenter || !googleMap.current) return
    const G = (window as any).google
    if (!G?.maps) return
    // Build a bounding box of 150 miles around the search point (1 degree lat ≈ 69 mi)
    const RADIUS_MI = 150
    const latDelta = RADIUS_MI / 69
    const lngDelta = RADIUS_MI / (69 * Math.cos(searchCenter.lat * Math.PI / 180))
    const bounds = new G.maps.LatLngBounds(
      { lat: searchCenter.lat - latDelta, lng: searchCenter.lng - lngDelta },
      { lat: searchCenter.lat + latDelta, lng: searchCenter.lng + lngDelta }
    )
    googleMap.current.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 })
  }, [searchCenter, mapLoaded])

  // When a station is selected while a manual search is active, zoom in to ~100 mile radius around that station
  useEffect(() => {
    if (!mapLoaded || !selectedStation || !searchCenter || !googleMap.current) return
    const G = (window as any).google
    if (!G?.maps) return
    const RADIUS_MI = 100
    const latDelta = RADIUS_MI / 69
    const lngDelta = RADIUS_MI / (69 * Math.cos(selectedStation.lat * Math.PI / 180))
    const bounds = new G.maps.LatLngBounds(
      { lat: selectedStation.lat - latDelta, lng: selectedStation.lng - lngDelta },
      { lat: selectedStation.lat + latDelta, lng: selectedStation.lng + lngDelta }
    )
    googleMap.current.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 })
  }, [selectedStation, searchCenter, mapLoaded])

  const findClosest = () => {
    setLocating(true)
    setLocError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords
        setUserLocation({ lat: latitude, lng: longitude })
        if (!data) { setLocating(false); return }
        let closest: Station | null = null
        let minDist = Infinity
        data.stations.forEach(s => {
          const d = Math.sqrt((s.lat - latitude) ** 2 + (s.lng - longitude) ** 2)
          if (d < minDist) { minDist = d; closest = s }
        })
        setClosestStation(closest)
        setSelectedStation(closest)
        // Filter list and zoom map to show all stations in the same state
        const closestStation = closest as Station | null
        if (closestStation) {
          setSelectedState(closestStation.state)
          // Zoom map to fit all stations in that state
          if (googleMap.current && (window as any).google) {
            const G = (window as any).google
            const bounds = new G.maps.LatLngBounds()
            data.stations
              .filter(s => s.state === closestStation.state)
              .forEach(s => bounds.extend({ lat: s.lat, lng: s.lng }))
            // Also include user location in bounds
            bounds.extend({ lat: latitude, lng: longitude })
            googleMap.current.fitBounds(bounds, { padding: 60 })
          }
        }
        setLocating(false)
      },
      () => {
        setLocError('Could not get location. Please allow location access.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const planRoute = useCallback(async () => {
    if (!origin.trim() || !destination.trim()) {
      setRouteError('Please enter both origin and destination.')
      return
    }
    if (!data) return

    setRouteLoading(true)
    setRouteError('')
    setRouteStations([])
    setRouteInfo(null)

    const G = (window as any).google
    if (!G) { setRouteError('Google Maps not loaded.'); setRouteLoading(false); return }

    // Clear previous route
    if (routeRendererRef.current) {
      routeRendererRef.current.setMap(null)
      routeRendererRef.current = null
    }

    const directionsService = new G.maps.DirectionsService()
    const directionsRenderer = new G.maps.DirectionsRenderer({
      map: googleMap.current,
      suppressMarkers: false,
      polylineOptions: { strokeColor: '#D71920', strokeWeight: 4, strokeOpacity: 0.85 },
    })
    routeRendererRef.current = directionsRenderer

    // First compute baseline (direct) distance without waypoints, then the actual route with waypoints.
    // This lets us report "+X miles added" by the via-points.
    const validVias = viaPoints.map(v => v.trim()).filter(v => v.length > 0)

    const doRoute = () => {
      const routeRequest: any = {
        origin: origin.trim(),
        destination: destination.trim(),
        travelMode: G.maps.TravelMode.DRIVING,
        avoidTolls: true,
      }
      if (validVias.length > 0) {
        routeRequest.waypoints = validVias.map(loc => ({ location: loc, stopover: true }))
        routeRequest.optimizeWaypoints = false // keep the order the user specified
      }
      directionsService.route(routeRequest, (result: any, status: any) => {
        if (status !== 'OK') {
          setRouteError(`Could not find route: ${status}. Try adding state abbreviations (e.g. "Salt Lake City, UT").`)
          setRouteLoading(false)
          return
        }

        directionsRenderer.setDirections(result)

        // Zoom map to fit the entire route — use setTimeout to let renderer finish
        setTimeout(() => {
          const routeBounds = result.routes[0].bounds
          if (routeBounds && googleMap.current) {
            googleMap.current.fitBounds(routeBounds, { top: 40, right: 40, bottom: 40, left: 40 })
          }
        }, 100)

        // Sum across all legs (important when waypoints are present — each leg is origin→waypoint, waypoint→waypoint, waypoint→dest)
        let totalMeters = 0
        let totalDriveSeconds = 0
        result.routes[0].legs.forEach((l: any) => {
          totalMeters += l.distance.value
          totalDriveSeconds += l.duration.value
        })
        const totalMiles = totalMeters * 0.000621371
        const driveSeconds = totalDriveSeconds

        // Compute extra miles from via-points (vs direct route)
        const directMilesBaseline = (window as any).__directMilesBaseline
        if (directMilesBaseline != null && validVias.length > 0) {
          const extra = Math.max(0, totalMiles - directMilesBaseline)
          setExtraMilesFromVias(extra)
        } else {
          setExtraMilesFromVias(0)
        }

        // HOS calculation: truckers can only drive 11 hours before requiring a 10-hour break.
        const MAX_MILES_PER_SHIFT = 700
        const MAX_DRIVE_BEFORE_BREAK_SECONDS = 10.5 * 3600
        const BREAK_SECONDS = 10 * 3600
        const breaksFromMiles = Math.floor(totalMiles / MAX_MILES_PER_SHIFT)
        const breaksFromTime = Math.floor(driveSeconds / MAX_DRIVE_BEFORE_BREAK_SECONDS)
        const numBreaks = Math.max(breaksFromMiles, breaksFromTime)
        const totalSeconds = driveSeconds + (numBreaks * BREAK_SECONDS)
        const formatDuration = (secs: number): string => {
          const totalHours = secs / 3600
          if (totalHours < 24) {
            const h = Math.floor(totalHours)
            const m = Math.round((totalHours - h) * 60)
            return m > 0 ? `${h}h ${m}m` : `${h}h`
          }
          const days = Math.floor(totalHours / 24)
          const remHours = Math.round(totalHours - (days * 24))
          return `${days}d ${remHours}h`
        }
        const hosDuration = numBreaks > 0
          ? `${formatDuration(totalSeconds)} (incl. ${numBreaks} × 10hr break${numBreaks > 1 ? 's' : ''})`
          : formatDuration(driveSeconds)
        // Distance text: custom format since legs[0].distance only covers first leg
        const distanceText = `${Math.round(totalMiles)} mi`
        setRouteInfo({
          distance: distanceText,
          duration: hosDuration,
          miles: totalMiles,
        })
        const leg = result.routes[0].legs[0] // for start_location
        // Capture start/end coords for email map rendering & weather
        const firstLeg = result.routes[0].legs[0]
        const lastLeg = result.routes[0].legs[result.routes[0].legs.length - 1]
        setOriginLatLng({ lat: firstLeg.start_location.lat(), lng: firstLeg.start_location.lng() })
        setDestLatLng({ lat: lastLeg.end_location.lat(), lng: lastLeg.end_location.lng() })

        // Capture Directions API warnings (restricted roads, closures, etc.)
        const alerts: Array<{severity: 'warning' | 'info', title: string, detail?: string}> = []
        const routeWarnings = result.routes[0].warnings || []
        routeWarnings.forEach((w: string) => {
          alerts.push({ severity: 'warning', title: 'Route Advisory', detail: w })
        })

        // Decode route polyline into points with cumulative distance
        const routePoints: {lat: number, lng: number}[] = []
        const routeCumulativeMiles: number[] = [] // distance from origin at each point
        // Also capture step info (instructions, maneuver, path indexes) for narrative/exit lookup
        type RouteStep = {
          instruction: string      // HTML, like "Take exit 234 for US-50 W"
          plainText: string        // HTML-stripped
          maneuver: string         // "ramp-right", "merge", "turn-left", etc.
          distance: number         // miles
          startMileFromOrigin: number
          endMileFromOrigin: number
          startPoint: {lat: number, lng: number}
          endPoint: {lat: number, lng: number}
        }
        const routeSteps: RouteStep[] = []
        let cumMiles = 0
        result.routes[0].legs.forEach((leg: any) => {
          leg.steps.forEach((step: any) => {
            const stepStartMile = cumMiles
            const stepDistance = (step.distance?.value || 0) * 0.000621371
            step.path.forEach((pt: any) => {
              if (routePoints.length > 0) {
                const prev = routePoints[routePoints.length - 1]
                cumMiles += haversine(prev.lat, prev.lng, pt.lat(), pt.lng())
              }
              routePoints.push({ lat: pt.lat(), lng: pt.lng() })
              routeCumulativeMiles.push(cumMiles)
            })
            // Record the step itself for later lookup
            const stepEndMile = cumMiles
            const plainText = (step.instructions || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            routeSteps.push({
              instruction: step.instructions || '',
              plainText,
              maneuver: step.maneuver || '',
              distance: stepDistance,
              startMileFromOrigin: stepStartMile,
              endMileFromOrigin: stepEndMile,
              startPoint: { lat: step.start_location.lat(), lng: step.start_location.lng() },
              endPoint: { lat: step.end_location.lat(), lng: step.end_location.lng() },
            })
          })
        })

        // Build route narrative: major freeways traveled + key exit/interchange transitions
        // We want short, human-readable lines like "I-80 E for 340mi → Exit 204 to I-15 N"
        const buildRouteNarrative = (): Array<{ road: string, miles: number, exitNote?: string }> => {
          // Extract highway name from a step's instruction text
          const extractHighway = (txt: string): string | null => {
            // Matches I-80, US-50, CA-99, SR-99, Route 66, Highway 101, etc.
            const m = txt.match(/\b(?:I-\d+|US-\d+|US Hwy \d+|SR-\d+|CA-\d+|TX-\d+|FL-\d+|NY-\d+|NJ-\d+|PA-\d+|OH-\d+|IN-\d+|IL-\d+|MO-\d+|KS-\d+|CO-\d+|UT-\d+|NV-\d+|OR-\d+|WA-\d+|ID-\d+|MT-\d+|WY-\d+|NE-\d+|IA-\d+|MN-\d+|WI-\d+|MI-\d+|KY-\d+|TN-\d+|NC-\d+|SC-\d+|GA-\d+|AL-\d+|MS-\d+|LA-\d+|AR-\d+|OK-\d+|NM-\d+|AZ-\d+|Highway \d+|Hwy \d+|Route \d+)\b/i)
            return m ? m[0].toUpperCase().replace(/HWY/i, 'Hwy').replace(/HIGHWAY/i, 'Highway').replace(/ROUTE/i, 'Route') : null
          }
          const extractExit = (txt: string): string | null => {
            const m = txt.match(/exit\s+(\d+[A-Za-z]?)/i)
            return m ? `Exit ${m[1]}` : null
          }

          // Pass 1: walk steps, build raw segments per highway transition
          const rawSegments: Array<{ road: string, miles: number, startMile: number, endMile: number }> = []
          let currentRoad = ''
          let currentStart = 0
          for (let i = 0; i < routeSteps.length; i++) {
            const s = routeSteps[i]
            const hw = extractHighway(s.plainText)
            if (hw && hw !== currentRoad) {
              if (currentRoad) {
                const miles = s.startMileFromOrigin - currentStart
                rawSegments.push({ road: currentRoad, miles, startMile: currentStart, endMile: s.startMileFromOrigin })
              }
              currentRoad = hw
              currentStart = s.startMileFromOrigin
            }
          }
          if (currentRoad) {
            rawSegments.push({ road: currentRoad, miles: totalMiles - currentStart, startMile: currentStart, endMile: totalMiles })
          }

          // Pass 2: consolidate — if same highway appears multiple times and total across that highway
          // is a significant fraction of the trip, merge into one entry showing total miles on it
          const roadTotals: Map<string, { miles: number, firstStart: number }> = new Map()
          rawSegments.forEach(seg => {
            const existing = roadTotals.get(seg.road)
            if (existing) {
              existing.miles += seg.miles
            } else {
              roadTotals.set(seg.road, { miles: seg.miles, firstStart: seg.startMile })
            }
          })

          // Keep only highways that account for at least 5% of the route OR at least 30 miles
          const minMiles = Math.max(30, totalMiles * 0.05)
          const significant = Array.from(roadTotals.entries())
            .filter(([_, v]) => v.miles >= minMiles)
            .sort((a, b) => a[1].firstStart - b[1].firstStart) // sort by order encountered
            .map(([road, v]) => ({ road, miles: v.miles }))

          return significant
        }
        const routeNarrative = buildRouteNarrative()

        // For each station candidate, find the nearest step with exit info
        const findExitForMile = (mileFromOrigin: number): string | null => {
          // Search window: 3 miles before the station's closest route point
          const searchStartMile = Math.max(0, mileFromOrigin - 5)
          const searchEndMile = mileFromOrigin + 1
          const stepsInWindow = routeSteps.filter(s =>
            s.endMileFromOrigin >= searchStartMile && s.startMileFromOrigin <= searchEndMile
          )
          // Look for exit mention in instruction text, prefer ramp-right maneuver
          for (const s of stepsInWindow.reverse()) {
            const m = s.plainText.match(/exit\s+(\d+[A-Za-z]?)[^.]*?(?:toward|to|for)\s+([^.]+?)(?:[.,]|$)/i)
            if (m) {
              return `Exit ${m[1]} — ${m[2].trim().slice(0, 50)}`
            }
            const simpleExit = s.plainText.match(/exit\s+(\d+[A-Za-z]?)/i)
            if (simpleExit) return `Exit ${simpleExit[1]}`
          }
          return null
        }
        // Attach exit info to each station within the corridor
        const stationExitInfo = new Map<string, string>()

        // Compute min-distance-to-route for every station (regardless of corridor)
        const stationDistances = data.stations.map(s => {
          let minDist = Infinity
          let closestIdx = 0
          for (let i = 0; i < routePoints.length; i++) {
            const d = haversine(s.lat, s.lng, routePoints[i].lat, routePoints[i].lng)
            if (d < minDist) { minDist = d; closestIdx = i }
          }
          return { station: s, minDist, closestIdx }
        })

        // Filter to corridor and build maps
        const distMap = new Map<string, number>()
        const detourMap = new Map<string, number>()
        const nearby = stationDistances.filter(({ station, minDist, closestIdx }) => {
          if (minDist <= corridorMiles) {
            const mileFromOrigin = routeCumulativeMiles[closestIdx]
            distMap.set(station.site, mileFromOrigin)
            // Detour = 2 * straight-line distance from route (out and back)
            detourMap.set(station.site, minDist * 2)
            // Look for exit info near this station
            const exit = findExitForMile(mileFromOrigin)
            if (exit) stationExitInfo.set(station.site, exit)
            return true
          }
          return false
        }).map(d => d.station).sort((a, b) => (distMap.get(a.site) || 0) - (distMap.get(b.site) || 0))

        setRouteDistanceMap(distMap)
        setRouteDetourMap(detourMap)
        setRouteStations(nearby)
        setRouteExitInfo(stationExitInfo)
        setRouteSummary(routeNarrative)
        setViewMode('route')
        setShowOptimizer(true)
        setRouteLoading(false)
        setSelectedStation(null)
        setRouteAlerts(alerts)
        // Auto-run optimizer with the freshly-computed data
        optimizeFuel(nearby, distMap, totalMiles, detourMap)

        // Sample weather at 8 evenly-spaced points along the route to detect severe conditions
        // (More samples = better chance of catching state-by-state variations on long routes)
        if (routePoints.length >= 8) {
          setAlertsLoading(true)
          const SAMPLE_COUNT = 8
          const samplePoints: Array<{lat: number, lng: number, pctAlong: number}> = []
          for (let i = 0; i < SAMPLE_COUNT; i++) {
            const idx = Math.floor(((i + 0.5) / SAMPLE_COUNT) * routePoints.length)
            const pt = routePoints[Math.min(idx, routePoints.length - 1)]
            samplePoints.push({ lat: pt.lat, lng: pt.lng, pctAlong: (i + 0.5) / SAMPLE_COUNT })
          }
          Promise.all(samplePoints.map(p =>
            fetch(`/api/weather?lat=${p.lat}&lng=${p.lng}`)
              .then(r => r.ok ? r.json() : null)
              .then(j => j ? { ...j, ...p } : null)
              .catch(() => null)
          )).then(async (results) => {
            const G = (window as any).google
            const geocoder = G?.maps ? new G.maps.Geocoder() : null

            // Thresholds per user requirements:
            // - Wind: >40 mph (sustained OR gusts)
            // - Precipitation: >60% probability (and actually precipitating, not dry fallback text)
            // - Visibility: <1 mile
            // - Also flag severe weather event types (hurricane, tornado, blizzard, etc.)
            const ALWAYS_SEVERE_TYPES = new Set([
              'BLIZZARD', 'HEAVY_SNOWSTORM', 'SNOWSTORM', 'BLOWING_SNOW',
              'HAIL', 'HAIL_SHOWERS',
              'THUNDERSTORM', 'HEAVY_THUNDERSTORM',
              'TROPICAL_STORM', 'HURRICANE', 'TORNADO',
              'FREEZING_RAIN', 'LIGHT_FREEZING_RAIN',
            ])

            type AlertHit = {
              category: 'wind' | 'precip' | 'visibility' | 'severe'
              title: string
              value?: string
              lat: number
              lng: number
              pctAlong: number
              temp: number | null
            }
            const alertHits: AlertHit[] = []

            results.filter(r => r && r.condition).forEach((c: any) => {
              // Severe event types - always flag
              if (c.conditionType && ALWAYS_SEVERE_TYPES.has(c.conditionType)) {
                alertHits.push({ category: 'severe', title: `⚠️ ${c.condition}`, lat: c.lat, lng: c.lng, pctAlong: c.pctAlong, temp: c.temp })
                return // don't double-count
              }
              // Wind > 40 mph
              const windValue = c.windGustMph != null ? c.windGustMph : (c.windSpeedMph || 0)
              if (windValue > 40) {
                const label = c.windGustMph != null ? `${Math.round(c.windGustMph)} mph gusts` : `${Math.round(c.windSpeedMph)} mph sustained`
                alertHits.push({ category: 'wind', title: `💨 High winds`, value: label, lat: c.lat, lng: c.lng, pctAlong: c.pctAlong, temp: c.temp })
              }
              // Precipitation probability > 60% (and actually a precipitation condition, not "clear 0%")
              if (c.precipitationProbability != null && c.precipitationProbability > 60) {
                const precipLabel = c.precipitationType
                  ? `${c.precipitationProbability}% ${c.precipitationType.toLowerCase()}`
                  : `${c.precipitationProbability}% precipitation`
                alertHits.push({ category: 'precip', title: `🌧 Heavy precipitation`, value: precipLabel, lat: c.lat, lng: c.lng, pctAlong: c.pctAlong, temp: c.temp })
              }
              // Visibility < 1 mile
              if (c.visibilityMiles != null && c.visibilityMiles < 1) {
                alertHits.push({ category: 'visibility', title: `🌫 Low visibility`, value: `${c.visibilityMiles.toFixed(1)} mi`, lat: c.lat, lng: c.lng, pctAlong: c.pctAlong, temp: c.temp })
              }
            })

            if (alertHits.length === 0) {
              setAlertsLoading(false)
              return
            }

            // Reverse-geocode each alert point to get city + state
            const geocoded = await Promise.all(alertHits.map(hit => {
              if (!geocoder) return Promise.resolve({ ...hit, city: '', state: '' })
              return new Promise<AlertHit & {city: string, state: string}>((resolve) => {
                geocoder.geocode({ location: { lat: hit.lat, lng: hit.lng } }, (res: any, status: any) => {
                  if (status !== 'OK' || !res || res.length === 0) {
                    resolve({ ...hit, city: '', state: '' })
                    return
                  }
                  let city = '', state = ''
                  for (const result of res) {
                    for (const comp of result.address_components || []) {
                      if (!city && (comp.types.includes('locality') || comp.types.includes('sublocality') || comp.types.includes('administrative_area_level_3'))) {
                        city = comp.short_name
                      }
                      if (!state && comp.types.includes('administrative_area_level_1')) {
                        state = comp.short_name
                      }
                    }
                    if (city && state) break
                  }
                  resolve({ ...hit, city, state })
                })
              })
            }))

            // Group by state + category — combine cities under same state+condition
            // Key: "state|title" → collect cities, values, temps
            type GroupEntry = { title: string, state: string, cities: string[], values: string[], temps: number[] }
            const grouped: Map<string, GroupEntry> = new Map()
            geocoded.forEach(g => {
              const key = `${g.state || 'unknown'}|${g.title}`
              if (!grouped.has(key)) {
                grouped.set(key, { title: g.title, state: g.state, cities: [], values: [], temps: [] })
              }
              const entry = grouped.get(key)!
              if (g.city && !entry.cities.includes(g.city)) entry.cities.push(g.city)
              if (g.value && !entry.values.includes(g.value)) entry.values.push(g.value)
              if (g.temp != null) entry.temps.push(g.temp)
            })

            const uniqueAlerts: Array<{severity: 'warning' | 'info', title: string, detail?: string}> = []
            grouped.forEach(entry => {
              const parts: string[] = []
              // Location: "City, City — STATE"
              if (entry.cities.length > 0 && entry.state) {
                parts.push(`${entry.cities.join(', ')}, ${entry.state}`)
              } else if (entry.state) {
                parts.push(entry.state)
              }
              // Severity value if applicable (wind speed, precip %, visibility mi)
              if (entry.values.length > 0) {
                parts.push(entry.values.join(' / '))
              }
              // Temp
              if (entry.temps.length > 0) {
                const avgTemp = Math.round(entry.temps.reduce((a, b) => a + b, 0) / entry.temps.length)
                parts.push(`${avgTemp}°F`)
              }
              uniqueAlerts.push({ severity: 'warning', title: entry.title, detail: parts.join(' — ') })
            })

            setRouteAlerts(prev => [...prev, ...uniqueAlerts])
            setAlertsLoading(false)
          }).catch(() => setAlertsLoading(false))
        }
      })  // end directionsService.route
    }  // end doRoute

    // If via-points exist, first fetch the DIRECT route (no waypoints) to compute extra miles added
    if (validVias.length > 0) {
      const directService = new G.maps.DirectionsService()
      directService.route({
        origin: origin.trim(),
        destination: destination.trim(),
        travelMode: G.maps.TravelMode.DRIVING,
        avoidTolls: true,
      }, (directResult: any, directStatus: any) => {
        if (directStatus === 'OK' && directResult.routes?.[0]) {
          // Sum all leg distances for the direct route
          let directMeters = 0
          directResult.routes[0].legs.forEach((l: any) => { directMeters += l.distance.value })
          const directMiles = directMeters * 0.000621371
          // Now do the actual route — we'll subtract in the callback below
          doRoute()
          // Note: extra miles will be set AFTER doRoute completes — handle via a state set in the doRoute callback instead.
          // We stash the baseline on a ref-like helper:
          ;(window as any).__directMilesBaseline = directMiles
        } else {
          // Baseline fetch failed, just proceed without extra miles calc
          ;(window as any).__directMilesBaseline = null
          doRoute()
        }
      })
    } else {
      ;(window as any).__directMilesBaseline = null
      setExtraMilesFromVias(0)
      doRoute()
    }
  }, [origin, destination, viaPoints, corridorMiles, data])

  const clearRoute = () => {
    if (routeRendererRef.current) {
      routeRendererRef.current.setMap(null)
      routeRendererRef.current = null
    }
    setRouteStations([])
    setRouteInfo(null)
    setRouteError('')
    setViewMode('all')
    setSelectedStation(null)
    setRouteAlerts([])
    setRouteExitInfo(new Map())
    setRouteSummary([])
    setViaPoints([])
    setExtraMilesFromVias(0)
    setIsRoundTrip(false)
    if (googleMap.current) {
      googleMap.current.setCenter({ lat: 39.5, lng: -98.35 })
      googleMap.current.setZoom(4)
    }
  }

  // Auto re-run optimizer when fuel level changes
  useEffect(() => {
    if (routeInfo && routeStations.length > 0 && viewMode === 'route') {
      optimizeFuel(routeStations, routeDistanceMap, routeInfo.miles, routeDetourMap)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFuelEighths])

  // Fuel optimizer: finds cheapest fill strategy, penalizing stations that require
  // long detours off the main route (> 20 miles detour unless savings justify it).
  const optimizeFuel = (stations: Station[], distMap: Map<string, number>, totalMiles: number, detourMap: Map<string, number> = new Map()) => {
    if (totalMiles === 0) { setOptimizedPlan(null); setOptimizerError(''); setSkippedStopIndices(new Set()); return }
    const TANK = 240, MIN_FUEL = 60, MIN_FILL = 50, MPG = 6, THRESHOLD = 0.20
    // Corridor = stations within 10 miles of route. These are always preferred.
    const CORRIDOR_DETOUR = 10
    // Mid-detour zone: 10-20mi off route. Only allowed if SIGNIFICANTLY cheaper than corridor option.
    const MID_DETOUR = 20
    // Beyond 20mi requires substantial savings or no other option. Hard cap is 50mi.
    const MAX_HARD_DETOUR = 50
    // Mid-detour station must save at least this much per gallon vs cheapest corridor option to be picked
    const MID_DETOUR_SAVINGS_THRESHOLD = 0.20  // 20 cents/gal
    const currentFuel = (currentFuelEighths / 8) * TANK
    const fuelToBurn = totalMiles / MPG

    // Corridor stations with position and detour data
    // Filter out backward stations: if the station's position along route is less than its detour,
    // it's essentially behind the origin (going to it means going backward)
    const byPos = stations
      .map(s => ({
        station: s,
        pos: distMap.get(s.site) ?? -1,
        detour: detourMap.get(s.site) ?? 0,
      }))
      .filter(s => {
        if (s.pos <= 0 || s.pos >= totalMiles) return false
        // Exclude stations that are clearly behind origin (backward direction)
        // A station whose position-from-origin is less than half its detour is probably backward
        if (s.pos < s.detour * 0.5) return false
        return true
      })
      .sort((a, b) => a.pos - b.pos)

    console.log('Optimizer:', { totalMiles, currentFuel, fuelToBurn, corridorCount: byPos.length, eighths: currentFuelEighths })

    // Build a human-readable debug summary that shows on the page
    if (byPos.length > 0 && byPos.length <= 8) {
    } else if (byPos.length > 8) {
    }

    setOptimizerError('')

    // Compute 15th-percentile price among all route stations — force full fills here
    const sortedPrices = byPos.map(s => s.station.yourPrice).sort((a, b) => a - b)
    const lowestPriceThreshold = sortedPrices.length > 0
      ? sortedPrices[Math.max(0, Math.floor(sortedPrices.length * 0.15) - 1)]
      : 0

    if (currentFuel - fuelToBurn >= MIN_FUEL) {
      setOptimizedPlan([])
      return
    }

    if (byPos.length === 0) {
      setOptimizedPlan([])
      setOptimizerError('No Pilot stations found along this route. You may need to get alternate fueling.')
      return
    }

    type Stop = {station: Station, gallons: number, milesFromOrigin: number, cost: number, savings: number, detour: number, resultsInFullTank?: boolean, fuelOnArrival?: number}

    const safeRange = (fuel: number) => Math.max(0, (fuel - MIN_FUEL) * MPG)
    const physicalRange = (fuel: number) => Math.max(50, fuel * MPG)

    // Compute the "effective price" of a station: actual price plus penalty for detour miles.
    // Stations within the corridor (≤10mi) have no penalty. Beyond that, every extra mile costs 5¢/gal
    // to discourage long detours unless savings clearly justify them.
    const CA_PENALTY = 1.00  // $1/gal penalty for CA — makes CA stations only picked if truly necessary
    const effectivePrice = (price: number, detour: number, state?: string): number => {
      let p = price
      if (state === 'CA') p += CA_PENALTY
      if (detour <= CORRIDOR_DETOUR) return p
      const extraDetour = detour - CORRIDOR_DETOUR
      return p + (extraDetour * 0.05)  // 5 cents per extra detour mile (heavy penalty for off-route stations)
    }

    // Smart candidate selection with tiered detour preference:
    // - Tier 1 (preferred): corridor stations within 10mi of route — always eligible
    // - Tier 2 (mid-detour): 10-20mi off route — only if cheapest one beats cheapest corridor by 20¢+/gal
    // - Tier 3 (hard detour): 20-50mi off route — last resort, only if no closer station reachable
    const getCandidates = (pos: number, fuel: number): Array<{station: Station, pos: number, detour: number}> => {
      const safeReach = pos + safeRange(fuel)
      const physReach = pos + physicalRange(fuel)

      // First try corridor stations only (within 10mi of route, safe reach)
      const corridor = byPos.filter(s => s.pos > pos && s.pos <= safeReach && s.detour <= CORRIDOR_DETOUR)
      const midDetour = byPos.filter(s => s.pos > pos && s.pos <= safeReach && s.detour > CORRIDOR_DETOUR && s.detour <= MID_DETOUR)

      if (corridor.length > 0) {
        // Find cheapest corridor station's price
        const cheapestCorridorPrice = Math.min(...corridor.map(c => c.station.yourPrice))
        // Include mid-detour stations only if they save MID_DETOUR_SAVINGS_THRESHOLD or more per gallon
        const eligibleMid = midDetour.filter(m =>
          cheapestCorridorPrice - m.station.yourPrice >= MID_DETOUR_SAVINGS_THRESHOLD
        )
        return [...corridor, ...eligibleMid]
      }

      // No corridor stations — try mid-detour (10-20mi)
      if (midDetour.length > 0) return midDetour

      // No corridor or mid-detour — try harder detours (20-50mi) as a last resort
      const hardDetour = byPos.filter(s => s.pos > pos && s.pos <= safeReach && s.detour <= MAX_HARD_DETOUR)
      if (hardDetour.length > 0) return hardDetour

      // Still nothing in safe reach — extend to physical reach (running tank low) within 50mi detour
      const physReachable = byPos.filter(s => s.pos > pos && s.pos <= physReach && s.detour <= MAX_HARD_DETOUR)
      if (physReachable.length > 0) return physReachable

      // Absolute last resort: anywhere reachable, regardless of detour
      return byPos.filter(s => s.pos > pos && s.pos <= physReach)
    }

    const buildPlan = (selector: (cands: Array<{station: Station, pos: number, detour: number}>) => {station: Station, pos: number, detour: number}): {plan: Stop[], unreachable: boolean} => {
      const plan: Stop[] = []
      let pos = 0, fuel = currentFuel
      let unreachable = false
      for (let iter = 0; iter < 30; iter++) {
        const distLeft = totalMiles - pos
        if (fuel - (distLeft / MPG) >= MIN_FUEL) {
          break
        }

        // FIRST-STOP DEFERRAL (iter === 0 only):
        // The driver should never be told to stop almost immediately after starting with fuel.
        // Defer the first fuel stop until the tank drops to 3/8 (90 gal) if a reachable station
        // exists past that point. This prevents "stop 49 miles from origin" cases at any starting level.
        // If no reachable station exists past 3/8, fall through to the 5/8 rule and normal logic.
        if (iter === 0) {
          const FIRST_STOP_THRESHOLD = 0.375 * TANK  // 90 gal = 3/8 of 240
          if (fuel > FIRST_STOP_THRESHOLD) {
            const gallonsUntilFirstStop = fuel - FIRST_STOP_THRESHOLD
            const milesUntilFirstStop = gallonsUntilFirstStop * MPG
            const minFirstStopPos = pos + milesUntilFirstStop
            const maxFirstStopPos = pos + safeRange(fuel)
            const firstStopCandidates = byPos.filter(s =>
              s.pos >= minFirstStopPos &&
              s.pos <= maxFirstStopPos &&
              s.detour <= MAX_HARD_DETOUR
            )
            if (firstStopCandidates.length > 0) {
              const chosen = selector(firstStopCandidates)
              const fuelAtStation = fuel - ((chosen.pos - pos) / MPG)
              const distFromStation = totalMiles - chosen.pos
              const gallonsToEndWithReserve = (distFromStation / MPG) + MIN_FUEL
              const roomInTank = TANK - fuelAtStation
              if (roomInTank >= MIN_FILL) {
                let fill = Math.min(roomInTank, gallonsToEndWithReserve)
                if (fill < MIN_FILL) fill = Math.min(MIN_FILL, roomInTank)
                const isBottomPrice = chosen.station.yourPrice <= lowestPriceThreshold
                if (isBottomPrice && roomInTank >= MIN_FILL) fill = roomInTank
                if (fuelAtStation + fill >= TANK * 0.90) fill = roomInTank
                if (chosen.station.state === 'CA') {
                  const nextNonCA = byPos.find(s => s.pos > chosen.pos && s.station.state !== 'CA')
                  if (nextNonCA) {
                    const gallonsToReachNext = ((nextNonCA.pos - chosen.pos) / MPG) + MIN_FUEL
                    const caFill = Math.max(MIN_FILL, gallonsToReachNext - fuelAtStation)
                    fill = Math.min(caFill, roomInTank)
                  }
                }
                fill = Math.min(Math.round(fill), Math.floor(roomInTank))
                if (fill < 1) break
                const tankAfterFill = fuelAtStation + fill
                const resultsInFullTank = tankAfterFill >= TANK - 5
                plan.push({
                  station: chosen.station, gallons: fill, milesFromOrigin: chosen.pos,
                  cost: fill * chosen.station.yourPrice, savings: fill * chosen.station.savings,
                  detour: chosen.detour,
                  resultsInFullTank,
                  fuelOnArrival: fuelAtStation,
                })
                fuel = fuelAtStation + fill
                pos = chosen.pos
                continue
              }
            }
            // No station available past 3/8 mark — fall through to 5/8 rule and normal logic
          }
        }

        // CRITICAL: Don't pick a fuel stop where the tank would still be above 5/8 (62.5%) when
        // arriving. This prevents "fuel 40 miles after starting with a full tank" situations.
        // The rule: a station is only eligible if (fuel when arriving) <= 5/8 of capacity.
        // This applies regardless of starting fuel level — if you started with 1/2 tank and a
        // station is 10 miles away, arriving fuel is ~48% which IS below 5/8, so it's eligible.
        // But if you started with a full tank and a station is 40 miles away, arriving fuel is
        // ~97% which is above 5/8, so it's NOT eligible — keep driving until fuel drops lower.
        {
          const thresholdFuel = 0.625 * TANK  // 150 gal = 5/8 of 240
          // Only apply this filter if we currently have MORE than 5/8 (otherwise normal logic kicks in)
          if (fuel > thresholdFuel) {
            const gallonsUntilThreshold = fuel - thresholdFuel
            const milesUntilThreshold = gallonsUntilThreshold * MPG
            const minPos = pos + milesUntilThreshold
            const maxPos = pos + safeRange(fuel)
            const eligibleStations = byPos.filter(s =>
              s.pos >= minPos &&  // tank will be at or below 5/8 when arriving
              s.pos <= maxPos &&       // and within safe reach
              s.detour <= MAX_HARD_DETOUR
            )
            if (eligibleStations.length > 0) {
              // Use the deferred candidates for picking the cheapest (rather than ALL candidates)
              const chosen = selector(eligibleStations)
              const fuelAtStation = fuel - ((chosen.pos - pos) / MPG)
              const distFromStation = totalMiles - chosen.pos
              const gallonsToEndWithReserve = (distFromStation / MPG) + MIN_FUEL
              const roomInTank = TANK - fuelAtStation
              if (roomInTank >= MIN_FILL) {  // Only proceed if there's enough room to meaningfully refuel
                let fill = Math.min(roomInTank, gallonsToEndWithReserve)
                if (fill < MIN_FILL) fill = Math.min(MIN_FILL, roomInTank)
                const isBottomPrice = chosen.station.yourPrice <= lowestPriceThreshold
                if (isBottomPrice && roomInTank >= MIN_FILL) fill = roomInTank
                if (fuelAtStation + fill >= TANK * 0.90) fill = roomInTank
                if (chosen.station.state === 'CA') {
                  const nextNonCA = byPos.find(s => s.pos > chosen.pos && s.station.state !== 'CA')
                  if (nextNonCA) {
                    const gallonsToReachNext = ((nextNonCA.pos - chosen.pos) / MPG) + MIN_FUEL
                    const caFill = Math.max(MIN_FILL, gallonsToReachNext - fuelAtStation)
                    fill = Math.min(caFill, roomInTank)
                  }
                }
                fill = Math.min(Math.round(fill), Math.floor(roomInTank))
                if (fill < 1) break
                const tankAfterFill = fuelAtStation + fill
                const resultsInFullTank = tankAfterFill >= TANK - 5
                plan.push({
                  station: chosen.station, gallons: fill, milesFromOrigin: chosen.pos,
                  cost: fill * chosen.station.yourPrice, savings: fill * chosen.station.savings,
                  detour: chosen.detour,
                  resultsInFullTank,
                  fuelOnArrival: fuelAtStation,
                })
                fuel = fuelAtStation + fill
                pos = chosen.pos
                continue
              }
            }
            // If no eligible station exists past the 5/8 threshold, fall through to normal logic
            // (this handles edge cases where the truck won't reach any station after the 5/8 mark)
          }
        }

        // Minimum burn rule: don't stop again until tank is below 70% full
        // (This prevents back-to-back fills like Wichita Falls → Amarillo after a 100% fill)
        // Skip this rule only if we can't reach any stop further out (forcing us to stop sooner)
        const fuelAtCurrentPos = fuel
        const pctFull = fuelAtCurrentPos / TANK
        // Only apply the "below 70%" rule if we JUST filled (iter > 0) and have enough fuel to wait
        if (iter > 0 && pctFull > 0.70) {
          // How far can we drive before dropping to 70%?
          const gallonsToBurnBeforeStop = fuelAtCurrentPos - (0.70 * TANK)
          const milesBeforeStop = gallonsToBurnBeforeStop * MPG
          const minNextPos = pos + milesBeforeStop
          // If there's a station past minNextPos that we can reach, wait till then
          const reachableAfterMin = byPos.filter(s =>
            s.pos > minNextPos &&
            s.pos <= pos + safeRange(fuel) &&
            s.detour <= MAX_HARD_DETOUR
          )
          if (reachableAfterMin.length > 0) {
            // Use the deferred candidates instead of the full set
            const chosen = selector(reachableAfterMin)
            const fuelAtStation = fuel - ((chosen.pos - pos) / MPG)
            const distFromStation = totalMiles - chosen.pos
            const gallonsToEndWithReserve = (distFromStation / MPG) + MIN_FUEL
            const roomInTank = TANK - fuelAtStation

            let fill = Math.min(roomInTank, gallonsToEndWithReserve)
            if (fill < MIN_FILL) fill = Math.min(MIN_FILL, roomInTank)
            const isBottomPrice = chosen.station.yourPrice <= lowestPriceThreshold
            if (isBottomPrice && roomInTank >= MIN_FILL) fill = roomInTank
            if (fuelAtStation + fill >= TANK * 0.90) fill = roomInTank
            // CA OVERRIDE in deferred branch too
            if (chosen.station.state === 'CA') {
              const nextNonCA = byPos.find(s => s.pos > chosen.pos && s.station.state !== 'CA')
              if (nextNonCA) {
                const gallonsToReachNext = ((nextNonCA.pos - chosen.pos) / MPG) + MIN_FUEL
                const caFill = Math.max(MIN_FILL, gallonsToReachNext - fuelAtStation)
                fill = Math.min(caFill, roomInTank)
              }
            }
            fill = Math.min(Math.round(fill), Math.floor(roomInTank))
            if (fill < 1) break

            const tankAfterFill = fuelAtStation + fill
            const resultsInFullTank = tankAfterFill >= TANK - 5
            plan.push({
              station: chosen.station, gallons: fill, milesFromOrigin: chosen.pos,
              cost: fill * chosen.station.yourPrice, savings: fill * chosen.station.savings,
              detour: chosen.detour,
              resultsInFullTank,
              fuelOnArrival: fuelAtStation,
            })
            fuel = fuelAtStation + fill
            pos = chosen.pos
            continue
          }
          // Otherwise fall through to normal logic (can't safely defer)
        }

        const cands = getCandidates(pos, fuel)
        if (cands.length === 0) { unreachable = true; break }

        const chosen = selector(cands)
        const fuelAtStation = fuel - ((chosen.pos - pos) / MPG)
        const distFromStation = totalMiles - chosen.pos
        const gallonsToEndWithReserve = (distFromStation / MPG) + MIN_FUEL
        const roomInTank = TANK - fuelAtStation

        // If there's not even enough room for the minimum fill (50 gal), this stop is pointless.
        // Can happen if the truck is still nearly full. Skip and try again further down the road.
        if (roomInTank < MIN_FILL) {
          // Advance past this station and look for another further along.
          // Use a slightly-forward position so the next iteration doesn't re-pick the same station.
          pos = chosen.pos + 1
          continue
        }

        let fill = Math.min(roomInTank, gallonsToEndWithReserve)
        if (fill < MIN_FILL) fill = Math.min(MIN_FILL, roomInTank)
        // If this station is in the lowest 15% of prices on this route, fill completely
        const isBottomPrice = chosen.station.yourPrice <= lowestPriceThreshold
        if (isBottomPrice && roomInTank >= MIN_FILL) {
          fill = roomInTank
        }
        // If the partial fill would put tank ≥90% full, just top it off
        if (fuelAtStation + fill >= TANK * 0.90) {
          fill = roomInTank
        }

        // CA OVERRIDE: if this station is in California, only fill enough to reach the next
        // non-CA station (plus reserve). Never top off in California.
        if (chosen.station.state === 'CA') {
          const nextNonCA = byPos.find(s => s.pos > chosen.pos && s.station.state !== 'CA')
          if (nextNonCA) {
            const milesToNextNonCA = nextNonCA.pos - chosen.pos
            const gallonsToReachNext = (milesToNextNonCA / MPG) + MIN_FUEL
            const caFill = Math.max(MIN_FILL, gallonsToReachNext - fuelAtStation)
            fill = Math.min(caFill, roomInTank)
          }
          // If no non-CA station is ahead (destination is in CA too), fill normally
        }

        fill = Math.min(Math.round(fill), Math.floor(roomInTank))
        if (fill < 1) break

        const tankAfterFill = fuelAtStation + fill
        const resultsInFullTank = tankAfterFill >= TANK - 5

        plan.push({
          station: chosen.station, gallons: fill, milesFromOrigin: chosen.pos,
          cost: fill * chosen.station.yourPrice, savings: fill * chosen.station.savings,
          detour: chosen.detour,
          resultsInFullTank,
          fuelOnArrival: fuelAtStation,
        })
        fuel = fuelAtStation + fill
        pos = chosen.pos
      }
      return { plan, unreachable }
    }

    // Strategy A: always pick cheapest reachable USING EFFECTIVE PRICE (detour-penalized + CA-penalized)
    const greedyResult = buildPlan(cands => cands.reduce((a, b) =>
      effectivePrice(a.station.yourPrice, a.detour, a.station.state) < effectivePrice(b.station.yourPrice, b.detour, b.station.state) ? a : b
    ))

    // Strategy B: fewest stops — among cheapest-effective-price, take furthest
    const fewestResult = buildPlan(cands => {
      const cheapest = cands.reduce((a, b) =>
        effectivePrice(a.station.yourPrice, a.detour, a.station.state) < effectivePrice(b.station.yourPrice, b.detour, b.station.state) ? a : b
      )
      const cheapestEff = effectivePrice(cheapest.station.yourPrice, cheapest.detour, cheapest.station.state)
      const near = cands.filter(s => effectivePrice(s.station.yourPrice, s.detour, s.station.state) - cheapestEff <= THRESHOLD)
      return near[near.length - 1]
    })

    const greedyPlan = greedyResult.plan
    const fewestStopsPlan = fewestResult.plan

    if (greedyResult.unreachable && fewestResult.unreachable) {
      setOptimizedPlan([])
      setOptimizerError('⚠️ Insufficient fuel to reach any Pilot station on this route. You may need to get alternate fueling before continuing.')
      return
    }

    let finalPlan = greedyPlan
    if (fewestStopsPlan.length > 0 && greedyPlan.length > 0 && fewestStopsPlan.length < greedyPlan.length) {
      const gGals = greedyPlan.reduce((s, p) => s + p.gallons, 0)
      const fGals = fewestStopsPlan.reduce((s, p) => s + p.gallons, 0)
      if (gGals > 0 && fGals > 0) {
        const gAvg = greedyPlan.reduce((s, p) => s + p.cost, 0) / gGals
        const fAvg = fewestStopsPlan.reduce((s, p) => s + p.cost, 0) / fGals
        if (fAvg - gAvg < THRESHOLD) finalPlan = fewestStopsPlan
      }
    }

    if (finalPlan.length === 0) finalPlan = fewestStopsPlan.length > 0 ? fewestStopsPlan : greedyPlan

    setOptimizedPlan(finalPlan)
    setSkippedStopIndices(new Set())
  }

  const avgPrice = filteredStations.length
    ? filteredStations.reduce((s, x) => s + x.yourPrice, 0) / filteredStations.length : 0
  const avgSavings = filteredStations.length
    ? filteredStations.reduce((s, x) => s + x.savings, 0) / filteredStations.length : 0
  const bestStation = filteredStations.length
    ? filteredStations.reduce((a, b) => a.yourPrice < b.yourPrice ? a : b) : null

  // Shared helper: resolve a recipient input string to email addresses and send the fuel plan email.
  // Used by both the email modal button AND voice-commanded auto-send.
  // Returns { ok, message } to the caller. Does NOT manage modal visibility — caller handles UI.
  const sendFuelEmail = useCallback(async (recipientInput: string): Promise<{ ok: boolean, message: string }> => {
    const trimmed = recipientInput.trim()
    if (!trimmed || !optimizedPlan || optimizedPlan.length === 0) {
      return { ok: false, message: 'No route planned or no recipient provided' }
    }
    let recipients: string[] = []
    if (trimmed.includes('@')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return { ok: false, message: 'Invalid email address: ' + trimmed }
      }
      recipients = [trimmed]
    } else {
      try {
        const lookupRes = await fetch(`/api/recipient-lookup?q=${encodeURIComponent(trimmed)}`)
        if (!lookupRes.ok) return { ok: false, message: 'Lookup failed for: ' + trimmed }
        const lookup = await lookupRes.json()
        if (!lookup.matches || lookup.matches.length === 0) {
          return { ok: false, message: 'No driver found for: ' + trimmed }
        }
        recipients = lookup.matches.map((m: any) => m.email)
      } catch (e: any) {
        return { ok: false, message: 'Lookup error: ' + e.message }
      }
    }
    const promises: Array<Promise<any>> = [
      fetch('/api/fuel-stats').then(r => r.ok ? r.json() : null).catch(() => null),
      originLatLng ? fetch(`/api/weather?lat=${originLatLng.lat}&lng=${originLatLng.lng}`).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
      destLatLng ? fetch(`/api/weather?lat=${destLatLng.lat}&lng=${destLatLng.lng}`).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
    ]
    const [stats, originWx, destWx] = await Promise.all(promises)
    const weather: any = {}
    if (originWx?.temp != null) weather.origin = originWx
    if (destWx?.temp != null) weather.destination = destWx
    const sendResults = await Promise.all(recipients.map(async (toAddr) => {
      const res = await fetch('/api/fuel-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toAddr,
          origin, destination,
          distance: routeInfo?.distance || '',
          duration: routeInfo?.duration || '',
          stops: optimizedPlan.map(s => ({
            ...s,
            exitInfo: routeExitInfo.get(s.station.site) || null,
          })),
          routeSummary: routeSummary.length > 0 ? routeSummary : undefined,
          originLatLng,
          destLatLng,
          weather: Object.keys(weather).length > 0 ? weather : undefined,
          priceStats: stats || undefined,
          routeAlerts: routeAlerts.length > 0 ? routeAlerts : undefined,
          viaPoints: viaPoints.filter(v => v.trim()).length > 0 ? viaPoints.filter(v => v.trim()) : undefined,
          extraMilesFromVias: extraMilesFromVias > 0 ? Math.round(extraMilesFromVias) : undefined,
          isRoundTrip: viaPoints.some(v => v.trim()) ? isRoundTrip : undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      return { ok: res.ok, json, to: toAddr }
    }))
    const failures = sendResults.filter(r => !r.ok)
    if (failures.length === 0) {
      return { ok: true, message: recipients.length === 1
        ? `Email sent to ${recipients[0]}`
        : `Sent to ${recipients.length} recipients` }
    }
    return { ok: false, message: failures[0].json?.error || 'Failed to send' }
  }, [optimizedPlan, origin, destination, routeInfo, routeExitInfo, routeSummary, originLatLng, destLatLng, routeAlerts, viaPoints, extraMilesFromVias, isRoundTrip])

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--paper)',
      fontFamily: 'var(--body)',
      width: '100%',
      maxWidth: '100vw',
      paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
    }}>
      {/* Top bar — just a back pill, no header */}
      <div style={{
        padding: 'calc(12px + env(safe-area-inset-top)) 16px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <a
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '9px 16px',
            background: 'rgba(255,255,255,0.78)',
            border: '1px solid rgba(11,11,12,0.06)',
            borderRadius: 'var(--r-pill)',
            color: 'var(--ink)',
            fontFamily: 'var(--display)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            textDecoration: 'none',
            boxShadow: 'var(--sh-sm)',
            backdropFilter: 'saturate(180%) blur(20px)',
            WebkitBackdropFilter: 'saturate(180%) blur(20px)',
            cursor: 'pointer',
            transition: 'all var(--t-fast) var(--ease)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          ← Back
        </a>
      </div>
      <h1 style={{
        fontFamily: 'var(--display)',
        fontSize: 22,
        fontWeight: 600,
        color: 'var(--ink)',
        textTransform: 'uppercase',
        letterSpacing: '-0.01em',
        padding: '4px 16px 0',
        lineHeight: 1,
      }}>
        Fuel Optimization
      </h1>
      <p style={{
        fontFamily: 'var(--display)',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--mute)',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        padding: '6px 16px 12px',
      }}>
        Daily prices · Pilot Travel Centers
      </p>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '8px 16px 40px' }}>

        {/* Date */}
        {data && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ fontSize: 12, color: 'var(--mute)', fontFamily: 'var(--body)' }}>
              <span className="sx-kicker" style={{ marginRight: 6 }}>Effective</span>
              <strong style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontWeight: 600 }}>{data.updatedAt}</strong>
            </p>
            <p style={{ fontSize: 11, color: 'var(--mute-2)', fontFamily: 'var(--display)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 500 }}>
              US Direct Bill — Pilot Travel Centers
            </p>
          </div>
        )}

        {/* Stale data warning — shown if the data is >48 hours old */}
        {data && (() => {
          const updated = new Date(data.updatedAt)
          const ageHours = (Date.now() - updated.getTime()) / (1000 * 60 * 60)
          if (isNaN(ageHours) || ageHours <= 48) return null
          return (
            <div style={{
              padding: '12px 16px',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 'var(--r-md)',
              marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 12,
              boxShadow: 'var(--sh-sm)',
            }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <p className="sx-display" style={{ fontSize: 14, color: '#991B1B' }}>Fuel data may be stale</p>
                <p style={{ fontSize: 12, color: '#7F1D1D', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  Prices were last updated {Math.round(ageHours)} hours ago.
                </p>
              </div>
            </div>
          )
        })()}

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['route', 'all'] as const).map(mode => (
            <button key={mode} onClick={() => { setSelectedStation(null); if (mode === 'all') clearRoute(); else setViewMode('route') }} style={{
              fontFamily: 'var(--display)', fontSize: 13, fontWeight: 600, letterSpacing: '0.08em',
              padding: '10px 20px', borderRadius: 'var(--r-pill)',
              border: '1px solid',
              background: viewMode === mode
                ? 'linear-gradient(180deg, #1A1B1F 0%, #0B0B0C 100%)'
                : 'var(--white)',
              color: viewMode === mode ? '#fff' : 'var(--ink)',
              borderColor: viewMode === mode ? 'var(--ink)' : 'var(--line)',
              boxShadow: viewMode === mode ? 'var(--sh-md)' : 'var(--sh-sm)',
              cursor: 'pointer', textTransform: 'uppercase',
              transition: 'all var(--t-base) var(--ease)',
            }}>
              {mode === 'all' ? '🗺 All Stations' : '🛣 Route Planner'}
            </button>
          ))}
        </div>

        {/* Route planner panel */}
        {viewMode === 'route' && (
          <div className="sx-card sx-fade-in" style={{ marginBottom: 14 }}>
            <p className="sx-kicker" style={{ marginBottom: 12 }}>
              Plan Your Route
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                ref={originRef}
                defaultValue={origin}
                onChange={e => setOrigin(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && planRoute()}
                placeholder="Origin — start typing a city..."
                autoComplete="off"
                className="sx-input"
              />
              {viaPoints.map((vp, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    ref={el => { viaRefs.current[idx] = el }}
                    value={vp}
                    onChange={e => {
                      const next = [...viaPoints]
                      next[idx] = e.target.value
                      setViaPoints(next)
                    }}
                    onKeyDown={e => e.key === 'Enter' && planRoute()}
                    placeholder={`Stop ${idx + 1} — start typing a city...`}
                    autoComplete="off"
                    className="sx-input"
                    style={{
                      flex: 1,
                      borderColor: 'var(--amber-line)',
                      background: 'var(--amber-bg)',
                    }}
                  />
                  <button
                    onClick={() => {
                      setViaPoints(viaPoints.filter((_, i) => i !== idx))
                      viaRefs.current.splice(idx, 1)
                      viaAutoRefs.current.splice(idx, 1)
                    }}
                    style={{
                      padding: '10px 14px', background: 'var(--white)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-md)',
                      cursor: 'pointer', fontSize: 16, color: 'var(--mute)',
                      lineHeight: 1, fontWeight: 700,
                      transition: 'all var(--t-fast) var(--ease)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--red)'
                      e.currentTarget.style.borderColor = 'var(--red)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--mute)'
                      e.currentTarget.style.borderColor = 'var(--line)'
                    }}
                    title="Remove this stop"
                  >×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setViaPoints([...viaPoints, ''])}
                  className="sx-btn-soft"
                  style={{
                    borderColor: 'var(--amber-line)',
                    background: 'var(--amber-bg)',
                    color: '#92400E',
                  }}
                >
                  + Add stop
                </button>
                <button
                  onClick={() => {
                    if (!navigator.geolocation) {
                      alert('Location access not supported on this device.')
                      return
                    }
                    setRouteError('')
                    // Show a temporary placeholder so the user knows we're working
                    setOrigin('📍 Getting your location...')
                    if (originRef.current) originRef.current.value = '📍 Getting your location...'
                    navigator.geolocation.getCurrentPosition(
                      (pos) => {
                        const { latitude, longitude } = pos.coords
                        // Reverse-geocode to a human-readable city, state via Google Maps API
                        const G = (window as any).google
                        if (G?.maps) {
                          const geocoder = new G.maps.Geocoder()
                          geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (results: any, status: any) => {
                            if (status === 'OK' && results?.[0]) {
                              // Find the most appropriate "City, State" formatted result
                              let cityState = ''
                              for (const r of results) {
                                const types = r.types || []
                                if (types.includes('locality') || types.includes('postal_code')) {
                                  // Build "City, State" from address components
                                  let city = '', state = ''
                                  for (const c of r.address_components) {
                                    if (c.types.includes('locality')) city = c.long_name
                                    else if (c.types.includes('administrative_area_level_1')) state = c.short_name
                                  }
                                  if (city && state) {
                                    cityState = `${city}, ${state}`
                                    break
                                  }
                                }
                              }
                              // Fall back to formatted_address if we couldn't extract city/state cleanly
                              const label = cityState || results[0].formatted_address
                              setOrigin(label)
                              setOriginLatLng({ lat: latitude, lng: longitude })
                              if (originRef.current) originRef.current.value = label
                            } else {
                              // Geocoding failed — fall back to using raw coordinates
                              const label = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
                              setOrigin(label)
                              setOriginLatLng({ lat: latitude, lng: longitude })
                              if (originRef.current) originRef.current.value = label
                            }
                          })
                        } else {
                          // Google Maps not loaded — use raw coordinates
                          const label = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
                          setOrigin(label)
                          setOriginLatLng({ lat: latitude, lng: longitude })
                          if (originRef.current) originRef.current.value = label
                        }
                      },
                      (err) => {
                        setOrigin('')
                        if (originRef.current) originRef.current.value = ''
                        if (err.code === err.PERMISSION_DENIED) {
                          setRouteError('Location permission denied. Enable location access in your browser settings.')
                        } else if (err.code === err.POSITION_UNAVAILABLE) {
                          setRouteError('Could not determine your location. Try entering a city manually.')
                        } else if (err.code === err.TIMEOUT) {
                          setRouteError('Location request timed out. Try again or enter a city manually.')
                        } else {
                          setRouteError('Could not get location: ' + err.message)
                        }
                      },
                      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
                    )
                  }}
                  style={{
                    padding: '8px 14px',
                    background: 'rgba(37,99,235,0.08)',
                    border: '1px dashed rgba(37,99,235,0.40)',
                    borderRadius: 'var(--r-pill)',
                    cursor: 'pointer',
                    fontSize: 12, color: '#1E40AF', fontWeight: 600,
                    fontFamily: 'var(--display)', letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    transition: 'all var(--t-fast) var(--ease)',
                  }}
                >
                  📍 Use my location
                </button>
              </div>
              {/* Round trip toggle — always visible (was hidden behind viaPoints check)
                  Used as a labeling concession: when checked + viaPoints exist, the
                  "X mi added" label is suppressed because those miles are intentional. */}
              <label className={`sx-toggle ${isRoundTrip ? 'is-on' : ''}`} style={{ alignSelf: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={isRoundTrip}
                  onChange={e => setIsRoundTrip(e.target.checked)}
                />
                <span>🔄 Part of a round trip</span>
              </label>
              <input
                ref={destRef}
                defaultValue={destination}
                onChange={e => setDestination(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && planRoute()}
                placeholder="Destination — start typing a city..."
                autoComplete="off"
                className="sx-input"
              />
              {/* Fuel level slider */}
              <div className="sx-card-flat">
                <p className="sx-kicker" style={{ marginBottom: 10, color: 'var(--steel)' }}>
                  ⛽ Current Fuel Level
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1, position: 'relative', paddingTop: 30 }}>
                    {/* Floating bubble that tracks the thumb position */}
                    <div
                      style={{
                        position: 'absolute',
                        left: `calc(${(currentFuelEighths / 8) * 100}% - ${(currentFuelEighths / 8) * 28 - 14}px)`,
                        top: 0,
                        transform: 'translateX(-50%)',
                        background: 'linear-gradient(180deg, #E8252C 0%, var(--red) 60%, #C61119 100%)',
                        color: '#fff',
                        fontFamily: 'var(--display)',
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        padding: '4px 10px',
                        borderRadius: 'var(--r-pill)',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        boxShadow: 'var(--sh-red)',
                        textTransform: 'uppercase',
                        transition: 'left 0.05s ease-out',
                      }}
                    >
                      {['Empty','1/8','1/4','3/8','1/2','5/8','3/4','7/8','Full'][currentFuelEighths]}
                      <div style={{
                        position: 'absolute',
                        bottom: -5,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 0,
                        height: 0,
                        borderLeft: '5px solid transparent',
                        borderRight: '5px solid transparent',
                        borderTop: '5px solid var(--red)',
                      }} />
                    </div>
                    <input
                      type="range" min={0} max={8} step={1} value={currentFuelEighths}
                      onChange={e => setCurrentFuelEighths(Number(e.target.value))}
                      style={{ width: '100%', display: 'block', accentColor: 'var(--red)' }}
                    />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: 'var(--mute)', fontFamily: 'var(--mono)' }}>
                  ≈ {((currentFuelEighths/8) * 240).toFixed(0)} gal in 240-gal tank · 6 mpg · min 1/4 tank reserve
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={planRoute}
                  disabled={routeLoading}
                  className="sx-btn"
                  style={{ flex: 1, padding: '16px 24px', fontSize: 15 }}
                >
                  {routeLoading ? 'Finding Route...' : '🛣 Find Fuel Stops'}
                </button>
                {routeStations.length > 0 && (
                  <button onClick={clearRoute} className="sx-btn-ghost">
                    Clear
                  </button>
                )}
              </div>
            </div>
            {routeError && <p style={{ fontSize: 13, color: 'var(--red)', marginTop: 10, fontWeight: 500 }}>{routeError}</p>}
            {routeInfo && (
              <>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="sx-pill"><span style={{ fontFamily: 'var(--mono)' }}>📍 {routeInfo.distance}</span></span>
                  <span className="sx-pill"><span style={{ fontFamily: 'var(--mono)' }}>⏱ {routeInfo.duration}</span></span>
                  {optimizedPlan && optimizedPlan.length > 0 && (
                    <span className="sx-pill sx-pill-red">
                      ⛽ Optimized — {optimizedPlan.length} {optimizedPlan.length === 1 ? 'stop' : 'stops'} for max savings
                    </span>
                  )}
                  {extraMilesFromVias > 0 && !isRoundTrip && (
                    <span className="sx-pill sx-pill-amber">
                      ➕ {Math.round(extraMilesFromVias)} mi added by {viaPoints.filter(v => v.trim()).length} extra {viaPoints.filter(v => v.trim()).length === 1 ? 'stop' : 'stops'}
                    </span>
                  )}
                  {viaPoints.some(v => v.trim()) && isRoundTrip && (
                    <span className="sx-pill sx-pill-green">
                      🔄 Round trip — extra stops are intentional
                    </span>
                  )}
                </div>
                {/* Route totals estimate */}
                {(() => {
                  const fuelNeeded = routeInfo.miles / 6
                  const avgPrice = routeStations.length > 0 ? routeStations.reduce((s, x) => s + x.yourPrice, 0) / routeStations.length : 0
                  const avgSavings = routeStations.length > 0 ? routeStations.reduce((s, x) => s + x.savings, 0) / routeStations.length : 0
                  const estCost = fuelNeeded * avgPrice
                  const estSavings = fuelNeeded * avgSavings
                  return (
                    <div style={{
                      marginTop: 10, padding: '12px 14px',
                      background: 'var(--amber-bg)',
                      border: '1px solid var(--amber-line)',
                      borderRadius: 'var(--r-md)',
                    }}>
                      <p className="sx-kicker" style={{ color: '#92400E', marginBottom: 6 }}>
                        Route Estimate (at 6 mpg)
                      </p>
                      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
                        <span style={{ color: 'var(--steel)' }}>
                          Fuel needed: <strong className="sx-mono" style={{ color: 'var(--ink)' }}>{fuelNeeded.toFixed(0)} gal</strong>
                        </span>
                        <span style={{ color: 'var(--steel)' }}>
                          Est. cost: <strong className="sx-mono" style={{ color: 'var(--red)' }}>${estCost.toFixed(2)}</strong>
                        </span>
                        <span style={{ color: 'var(--steel)' }}>
                          Est. savings: <strong className="sx-mono" style={{ color: 'var(--green)' }}>${estSavings.toFixed(2)}</strong>
                        </span>
                      </div>
                    </div>
                  )
                })()}
                {/* Fuel optimizer plan — uses fuel level from slider above */}
                {showOptimizer && (
                <div style={{ marginTop: 12 }}>
                    {optimizedPlan !== null && (
                      <div>
                        {optimizerError ? (
                          <div style={{
                            padding: 16,
                            background: '#FEF2F2',
                            border: '2px solid var(--red)',
                            borderRadius: 'var(--r-lg)',
                            boxShadow: 'var(--sh-md)',
                          }}>
                            <p style={{ fontFamily: 'var(--display)', fontSize: 14, fontWeight: 600, color: 'var(--red)', letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 8 }}>
                              ⚠️ Fuel Alert
                            </p>
                            <p style={{ fontSize: 14, color: '#7F1D1D', fontWeight: 500, lineHeight: 1.5 }}>
                              {optimizerError}
                            </p>
                            <p style={{ fontSize: 12, color: '#B91C1C', marginTop: 8, lineHeight: 1.5 }}>
                              Consider stopping at a non-Pilot station to refuel, or checking if the corridor radius should be increased.
                            </p>
                          </div>
                        ) : optimizedPlan.length === 0 ? (
                          <div style={{
                            padding: 14,
                            background: 'rgba(22,163,74,0.08)',
                            border: '1px solid rgba(22,163,74,0.28)',
                            borderRadius: 'var(--r-md)',
                          }}>
                            <p style={{ fontSize: 14, color: 'var(--green-deep)', fontWeight: 500 }}>
                              ✓ No fuel stops needed — you have enough to complete the route.
                            </p>
                          </div>
                        ) : (
                          <>
                            {/* Plan header */}
                            <div style={{
                              background: 'linear-gradient(180deg, #E8252C 0%, var(--red) 60%, #C61119 100%)',
                              borderRadius: 'var(--r-lg) var(--r-lg) 0 0',
                              padding: '12px 16px',
                              display: 'flex', alignItems: 'center', gap: 10,
                              boxShadow: 'var(--sh-red)',
                            }}>
                              <span style={{ fontSize: 18 }}>⛽</span>
                              <p style={{ fontFamily: 'var(--display)', fontSize: 14, fontWeight: 600, color: '#fff', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                                Your Fuel Plan · {optimizedPlan.length} {optimizedPlan.length === 1 ? 'Stop' : 'Stops'}
                              </p>
                            </div>

                            {/* Stops list */}
                            <div style={{ background: 'var(--white)', border: '1px solid var(--line)', borderTop: 'none', borderRadius: '0 0 var(--r-lg) var(--r-lg)' }}>
                              {optimizedPlan.map((stop, i) => {
                                // Skip stops the driver has chosen to bypass (because they want to fuel at the next, cheaper stop instead)
                                if (skippedStopIndices.has(i)) return null
                                // Shows FULL if the fill results in a full tank (accounting for current level), else PARTIAL
                                const displayAsFull = !!stop.resultsInFullTank
                                const fillPct = Math.round((stop.gallons / 240) * 100)
                                const isExpanded = expandedPlanStop === i
                                // Look ahead: is there a future stop on the plan that's significantly cheaper (≥20¢/gal)?
                                // Only consider the very next non-skipped stop in the plan.
                                const SAVINGS_NOTE_THRESHOLD = 0.20  // $0.20/gal
                                let nextCheaperStop: typeof stop | null = null
                                let nextCheaperStopIndex: number | null = null
                                for (let j = i + 1; j < optimizedPlan.length; j++) {
                                  if (skippedStopIndices.has(j)) continue
                                  const cand = optimizedPlan[j]
                                  if (stop.station.yourPrice - cand.station.yourPrice >= SAVINGS_NOTE_THRESHOLD) {
                                    nextCheaperStop = cand
                                    nextCheaperStopIndex = j
                                  }
                                  break // only check the immediate next stop, regardless of whether it qualifies
                                }
                                return (
                                  <div key={i} style={{
                                    borderBottom: i < optimizedPlan.length - 1 ? '1px solid var(--line)' : 'none',
                                  }}>
                                    <div onClick={() => {
                                      setExpandedPlanStop(isExpanded ? null : i)
                                      if (googleMap.current) googleMap.current.panTo({ lat: stop.station.lat, lng: stop.station.lng })
                                    }} style={{
                                      padding: '14px 16px',
                                      cursor: 'pointer',
                                      background: isExpanded ? 'var(--paper-warm)' : 'transparent',
                                      transition: 'background var(--t-fast) var(--ease)',
                                    }}>
                                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                                      {/* Stop number circle */}
                                      <div style={{
                                        width: 34, height: 34, borderRadius: '50%',
                                        background: 'linear-gradient(180deg, #E8252C 0%, var(--red) 60%, #C61119 100%)',
                                        color: '#fff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontFamily: 'var(--display)', fontSize: 16, fontWeight: 600, flexShrink: 0,
                                        boxShadow: 'var(--sh-red)',
                                      }}>{i + 1}</div>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 3, fontFamily: 'var(--body)' }}>
                                          {stop.station.description || 'Pilot Travel Center'} — {stop.station.city}, {stop.station.state}
                                        </p>
                                        {stop.station.address && (
                                          <p style={{ fontSize: 12, color: 'var(--mute)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {stop.station.address}{stop.station.zip ? ` · ${stop.station.zip}` : ''}
                                          </p>
                                        )}
                                        {stop.station.interstate && (
                                          <p style={{ fontSize: 12, color: '#9A3412', fontWeight: 600, marginBottom: 6, fontFamily: 'var(--display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                            🛣 {stop.station.interstate}
                                          </p>
                                        )}
                                        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--mute)', marginBottom: 10, flexWrap: 'wrap' }}>
                                          <span className="sx-mono">📍 Mile {stop.milesFromOrigin.toFixed(0)}</span>
                                          <span className="sx-mono">💵 ${stop.station.yourPrice.toFixed(2)}/gal</span>
                                          {stop.detour !== undefined && stop.detour > 2 && (
                                            <span className="sx-mono" style={{ color: stop.detour > 20 ? '#92400E' : 'var(--mute)' }}>
                                              ↪ {stop.detour.toFixed(0)} mi detour
                                            </span>
                                          )}
                                          <span style={{ color: 'var(--mute-2)', fontSize: 11, marginLeft: 'auto', fontFamily: 'var(--display)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                            {isExpanded ? '▲ Less' : '▼ Maps'}
                                          </span>
                                        </div>
                                        <div style={{
                                          background: displayAsFull ? '#FFF5F5' : 'var(--amber-bg)',
                                          border: '2px solid ' + (displayAsFull ? 'var(--red)' : 'var(--amber-line)'),
                                          borderRadius: 'var(--r-md)', padding: '10px 14px',
                                        }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                              <p className="sx-kicker" style={{ marginBottom: 2 }}>Fill Amount</p>
                                              <p className="sx-display" style={{ fontSize: 22, color: 'var(--red)' }}>
                                                {displayAsFull ? (
                                                  <>
                                                    Fill to Full
                                                    <span className="sx-pill sx-pill-red" style={{ marginLeft: 8, verticalAlign: 'middle', fontSize: 10 }}>FULL</span>
                                                  </>
                                                ) : (
                                                  <>
                                                    {stop.gallons} <span style={{ fontSize: 14 }}>gal</span>
                                                    <span className="sx-pill sx-pill-amber" style={{ marginLeft: 8, verticalAlign: 'middle', fontSize: 10 }}>Partial · {fillPct}%</span>
                                                  </>
                                                )}
                                              </p>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                              <p className="sx-kicker" style={{ marginBottom: 2 }}>Approximate Cost</p>
                                              <p className="sx-mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>${stop.cost.toFixed(2)}</p>
                                              <p className="sx-mono" style={{ fontSize: 10, color: 'var(--mute-2)' }}>{stop.gallons} gal × ${stop.station.yourPrice.toFixed(3)}</p>
                                              <p className="sx-mono" style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, marginTop: 2 }}>Save ${stop.savings.toFixed(2)}</p>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                    </div>
                                    {/* Expanded section with maps links */}
                                    {isExpanded && (
                                      <div style={{ padding: '0 16px 14px 62px', background: 'var(--paper-warm)', borderTop: '1px solid var(--line)' }}>
                                        <div style={{ display: 'flex', gap: 10, paddingTop: 12 }}>
                                          <a
                                            href={appleMapsUrl(stop.station)}
                                            onClick={e => e.stopPropagation()}
                                            className="sx-btn-ghost"
                                            style={{ flex: 1, textDecoration: 'none' }}
                                          >
                                            🍎 Open in Apple Maps
                                          </a>
                                          <a
                                            href={googleMapsUrl(stop.station)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={e => e.stopPropagation()}
                                            className="sx-btn-ghost"
                                            style={{ flex: 1, textDecoration: 'none' }}
                                          >
                                            🗺 Open in Google Maps
                                          </a>
                                        </div>
                                      </div>
                                    )}
                                    {/* Price-savings note: if the next stop is at least 20¢/gal cheaper,
                                        show a tappable note suggesting the driver skip this stop if they have enough fuel */}
                                    {nextCheaperStop && nextCheaperStopIndex !== null && (
                                      <div
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setSkippedStopIndices(prev => {
                                            const next = new Set(prev)
                                            next.add(i)
                                            return next
                                          })
                                          setExpandedPlanStop(nextCheaperStopIndex)
                                        }}
                                        style={{
                                          margin: '0 16px 12px 16px',
                                          padding: '12px 14px',
                                          background: 'rgba(22,163,74,0.08)',
                                          border: '1px solid rgba(22,163,74,0.28)',
                                          borderRadius: 'var(--r-md)',
                                          cursor: 'pointer',
                                          fontSize: 13,
                                          color: 'var(--green-deep)',
                                          lineHeight: 1.5,
                                          transition: 'all var(--t-fast) var(--ease)',
                                        }}
                                      >
                                        <p style={{ fontWeight: 600, marginBottom: 4, fontFamily: 'var(--display)', letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: 12 }}>
                                          💡 Save <span className="sx-mono">${(stop.station.yourPrice - nextCheaperStop.station.yourPrice).toFixed(2)}/gal</span>
                                        </p>
                                        <p>
                                          If you have enough fuel to reach <strong>{nextCheaperStop.station.city}, {nextCheaperStop.station.state}</strong> <span className="sx-mono">(${nextCheaperStop.station.yourPrice.toFixed(2)}/gal)</span>, fuel there instead. If not, fill in {stop.station.city} as planned.
                                        </p>
                                        <p style={{ marginTop: 6, fontWeight: 600, textDecoration: 'underline' }}>
                                          Tap to switch this stop to {nextCheaperStop.station.city} →
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>

                            {/* Summary box */}
                            <div style={{
                              background: 'linear-gradient(180deg, #1A1B1F 0%, #0B0B0C 100%)',
                              borderRadius: 'var(--r-lg)',
                              padding: '16px 18px',
                              color: '#fff',
                              marginTop: 12,
                              boxShadow: 'var(--sh-md)',
                            }}>
                              <p className="sx-kicker" style={{ color: 'var(--mute-2)', marginBottom: 10 }}>
                                Route Summary
                              </p>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'baseline' }}>
                                <span style={{ fontSize: 13, color: 'var(--mute-3)' }}>Total fuel to buy:</span>
                                <span className="sx-mono" style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>
                                  {optimizedPlan.filter((_, idx) => !skippedStopIndices.has(idx)).reduce((s, p) => s + p.gallons, 0)} gal
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'baseline' }}>
                                <span style={{ fontSize: 13, color: 'var(--mute-3)' }}>Total cost:</span>
                                <span className="sx-mono" style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>
                                  ${optimizedPlan.filter((_, idx) => !skippedStopIndices.has(idx)).reduce((s, p) => s + p.cost, 0).toFixed(2)}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.10)', alignItems: 'baseline' }}>
                                <span style={{ fontSize: 13, color: 'var(--mute-3)' }}>💰 Total savings vs retail:</span>
                                <span className="sx-display sx-mono" style={{ fontSize: 22, color: 'var(--green)' }}>
                                  ${optimizedPlan.filter((_, idx) => !skippedStopIndices.has(idx)).reduce((s, p) => s + p.savings, 0).toFixed(2)}
                                </span>
                              </div>
                            </div>

                            {/* Share buttons */}
                            <div style={{ marginTop: 12 }}>
                              <button
                                onClick={() => { setShowEmailModal(true); setEmailStatus(''); }}
                                style={{
                                  width: '100%', padding: '14px 24px',
                                  background: 'linear-gradient(180deg, #3B82F6 0%, #2563EB 60%, #1D4ED8 100%)',
                                  color: '#fff', border: 'none',
                                  borderRadius: 'var(--r-pill)',
                                  cursor: 'pointer', fontSize: 14, fontWeight: 600,
                                  fontFamily: 'var(--display)', letterSpacing: '0.08em', textTransform: 'uppercase',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                                  boxShadow: '0 4px 12px rgba(37,99,235,0.32), 0 10px 28px rgba(37,99,235,0.20), inset 0 1px 0 rgba(255,255,255,0.10)',
                                  transition: 'all var(--t-base) var(--ease)',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
                              >
                                ✉ Email This Plan
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Stats bar */}
        {filteredStations.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { label: 'Stations', value: filteredStations.length.toString() },
              { label: 'Avg Your Price', value: `$${avgPrice.toFixed(2)}` },
              { label: 'Avg Savings', value: `$${avgSavings.toFixed(2)}` },
              { label: 'Best Price', value: bestStation ? `$${bestStation.yourPrice.toFixed(2)} — ${bestStation.city}, ${bestStation.state}` : '' },
            ].map(s => (
              <div key={s.label} className="sx-stat" style={{ flex: 1, minWidth: 130 }}>
                <p className="sx-stat-label">{s.label}</p>
                <p className="sx-stat-value sx-mono">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Controls (only in all mode) */}
        {viewMode === 'all' && (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={selectedState}
                onChange={e => { setSelectedState(e.target.value); setSelectedStation(null) }}
                className="sx-input"
                style={{ flex: 1, minWidth: 160 }}
              >
                <option value="ALL">All States ({data?.stations.length ?? 0} stations)</option>
                {STATE_LIST.map(s => {
                  const cnt = data?.stations.filter(x => x.state === s).length ?? 0
                  return cnt > 0 ? <option key={s} value={s}>{s} ({cnt} stations)</option> : null
                })}
              </select>
              <button
                onClick={findClosest}
                disabled={locating}
                className="sx-btn"
                style={{ padding: '12px 20px', fontSize: 13 }}
              >
                📍 {locating ? 'Locating...' : 'Find Nearest'}
              </button>
            </div>

            {/* Manual location search */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
              <input
                ref={locSearchRef}
                value={locationSearch}
                onChange={e => setLocationSearch(e.target.value)}
                placeholder="🔎 Search by city, state (e.g. Amarillo, TX)"
                autoComplete="off"
                className="sx-input"
                style={{ flex: 1, minWidth: 0 }}
              />
              {searchCenter && (
                <button
                  onClick={() => { setLocationSearch(''); setSearchCenter(null) }}
                  className="sx-btn-ghost"
                >Clear</button>
              )}
            </div>

            {/* Location search result banner — best price among nearest 5 */}
            {searchCenter && bestOfNearest5 && stationsWithDistance && stationsWithDistance.length > 0 && (
              <div style={{
                background: 'rgba(22,163,74,0.08)',
                border: '1px solid rgba(22,163,74,0.28)',
                borderRadius: 'var(--r-lg)',
                padding: '14px 16px',
                marginBottom: 12,
                boxShadow: 'var(--sh-sm)',
              }}>
                <p className="sx-kicker" style={{ color: 'var(--green-deep)', marginBottom: 8 }}>
                  🏆 Best Price Near {searchCenter.label}
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                      {bestOfNearest5.description || 'Pilot Travel Center'} — {bestOfNearest5.city}, {bestOfNearest5.state}
                    </p>
                    <p style={{ fontSize: 11, color: '#15803D', marginTop: 2, fontFamily: 'var(--mono)' }}>
                      {(bestOfNearest5 as any).distanceMi.toFixed(1)} mi away · cheapest of {Math.min(5, stationsWithDistance.length)} nearest
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p className="sx-mono sx-display" style={{ fontSize: 22, color: 'var(--green)', lineHeight: 1 }}>
                      ${bestOfNearest5.yourPrice.toFixed(2)}
                    </p>
                    <p className="sx-kicker" style={{ color: '#15803D' }}>per gallon</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedStation(bestOfNearest5)}
                  style={{
                    marginTop: 10, padding: '10px 16px',
                    background: 'linear-gradient(180deg, #22C55E 0%, var(--green) 60%, #15803D 100%)',
                    color: '#fff', border: 'none',
                    borderRadius: 'var(--r-pill)',
                    cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    fontFamily: 'var(--display)', letterSpacing: '0.08em', textTransform: 'uppercase',
                    width: '100%',
                    boxShadow: '0 4px 12px rgba(22,163,74,0.30), inset 0 1px 0 rgba(255,255,255,0.10)',
                    transition: 'all var(--t-base) var(--ease)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
                >View Details</button>
              </div>
            )}
          </>
        )}

        {locError && <p style={{ fontSize: 13, color: 'var(--red)', marginBottom: 10, fontWeight: 500 }}>{locError}</p>}

        {/* Closest station callout */}
        {closestStation && viewMode === 'all' && (
          <div style={{
            background: 'rgba(22,163,74,0.08)',
            border: '1px solid rgba(22,163,74,0.28)',
            borderRadius: 'var(--r-md)',
            padding: '12px 14px', marginBottom: 12,
          }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--green-deep)' }}>
              Nearest: Pilot Travel Center — {closestStation.city}, {closestStation.state}
            </p>
            {closestStation.address && <p style={{ fontSize: 12, color: '#3B6D11', marginTop: 2 }}>{closestStation.address}</p>}
            <p style={{ fontSize: 12, color: '#3B6D11', marginTop: 4, fontFamily: 'var(--mono)' }}>
              ${closestStation.yourPrice.toFixed(2)}/gal · Save ${closestStation.savings.toFixed(2)} vs retail
              {userLocation && ` · ${haversine(userLocation.lat, userLocation.lng, closestStation.lat, closestStation.lng).toFixed(1)} mi away`}
            </p>
          </div>
        )}

        {/* Map */}
        <div className="sx-card-solid" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
          <div ref={mapRef} style={{ height: 420, width: '100%' }} />
          {!mapLoaded && (
            <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mute-2)', fontSize: 13, fontFamily: 'var(--display)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Loading map...
            </div>
          )}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: 11, color: 'var(--mute)', alignItems: 'center', flexWrap: 'wrap', fontFamily: 'var(--display)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}/>
            Cheapest
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#CA8A04', display: 'inline-block', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}/>
            Mid-range
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--red)', display: 'inline-block', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}/>
            Most expensive
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#1D4ED8', display: 'inline-block', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}/>
            Your Location
          </span>
        </div>

        {/* Selected station detail */}
        {selectedStation && (
          <div className="sx-card-solid sx-fade-in" style={{
            border: '2px solid var(--red)',
            marginBottom: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p className="sx-display" style={{ fontSize: 22, color: 'var(--ink)' }}>
                  {selectedStation.description || 'Pilot Travel Center'}
                </p>
                <p style={{ fontSize: 12, color: 'var(--mute)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  Site #{selectedStation.site} · {selectedStation.city}, {selectedStation.state}
                </p>
              </div>
              <button onClick={() => setSelectedStation(null)} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--mute-2)', cursor: 'pointer', lineHeight: 1, padding: 4 }}>×</button>
            </div>

            {selectedStation.interstate && (
              <div style={{ marginTop: 10, padding: '6px 12px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 'var(--r-pill)', display: 'inline-block' }}>
                <span style={{ fontSize: 12, color: '#9A3412', fontWeight: 600, fontFamily: 'var(--display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>🛣 {selectedStation.interstate}</span>
              </div>
            )}

            {selectedStation.address && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" style={{ marginTop: 2, flexShrink: 0 }}>
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  <span style={{ fontSize: 13, color: 'var(--steel)', lineHeight: 1.5 }}>
                    {selectedStation.address}<br/>
                    {selectedStation.city}, {selectedStation.state} {selectedStation.zip}
                  </span>
                </div>
              </div>
            )}

            {selectedStation.phone && (
              <a href={`tel:${selectedStation.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, textDecoration: 'none' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mute)" strokeWidth="2" strokeLinecap="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.99 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.93 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 5.93 5.93l1.17-1.17a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
                <span style={{ fontSize: 13, color: 'var(--steel)', fontFamily: 'var(--mono)' }}>{selectedStation.phone}</span>
              </a>
            )}

            <div style={{ display: 'flex', gap: 24, marginTop: 14 }}>
              <div>
                <p className="sx-kicker" style={{ marginBottom: 4 }}>Your Price</p>
                <p className="sx-display sx-mono" style={{ fontSize: 26, color: 'var(--red)' }}>${selectedStation.yourPrice.toFixed(2)}</p>
                <p style={{ fontSize: 10, color: 'var(--mute-2)', fontFamily: 'var(--display)', letterSpacing: '0.10em', textTransform: 'uppercase' }}>per gallon</p>
              </div>
              <div>
                <p className="sx-kicker" style={{ marginBottom: 4 }}>You Save</p>
                <p className="sx-display sx-mono" style={{ fontSize: 26, color: 'var(--green)' }}>${selectedStation.savings.toFixed(2)}</p>
                <p style={{ fontSize: 10, color: 'var(--mute-2)', fontFamily: 'var(--display)', letterSpacing: '0.10em', textTransform: 'uppercase' }}>vs retail</p>
              </div>
            </div>

            {/* Amenities Grid */}
            {(selectedStation.parking != null || selectedStation.dieselLanes != null || selectedStation.showers != null || selectedStation.catScale != null) && (
              <div className="sx-card-flat" style={{ marginTop: 14 }}>
                <p className="sx-kicker" style={{ marginBottom: 8 }}>Amenities</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  {selectedStation.parking != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>🅿️</span>
                      <span style={{ fontSize: 12, color: 'var(--steel)' }}><strong>{selectedStation.parking}</strong> parking</span>
                    </div>
                  )}
                  {selectedStation.dieselLanes != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>⛽</span>
                      <span style={{ fontSize: 12, color: 'var(--steel)' }}><strong>{selectedStation.dieselLanes}</strong> diesel lanes</span>
                    </div>
                  )}
                  {selectedStation.dieselDefLanes != null && selectedStation.dieselDefLanes > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>🧪</span>
                      <span style={{ fontSize: 12, color: 'var(--steel)' }}><strong>{selectedStation.dieselDefLanes}</strong> DEF lanes</span>
                    </div>
                  )}
                  {selectedStation.showers != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>🚿</span>
                      <span style={{ fontSize: 12, color: 'var(--steel)' }}><strong>{selectedStation.showers}</strong> showers</span>
                    </div>
                  )}
                  {selectedStation.catScale === true && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>⚖️</span>
                      <span style={{ fontSize: 12, color: 'var(--steel)' }}>CAT Scale</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Facilities / Restaurants */}
            {selectedStation.facilities && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#FEFCE8', border: '1px solid #FDE68A', borderRadius: 'var(--r-md)' }}>
                <p className="sx-kicker" style={{ color: '#854D0E', marginBottom: 4 }}>🍔 Food & Services</p>
                <p style={{ fontSize: 12, color: '#422006', lineHeight: 1.5 }}>{selectedStation.facilities}</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <a
                href={appleMapsUrl(selectedStation)}
                className="sx-btn-ghost"
                style={{ flex: 1, textDecoration: 'none', fontSize: 12 }}
              >
                🍎 Apple Maps
              </a>
              <a
                href={googleMapsUrl(selectedStation)}
                target="_blank"
                rel="noopener noreferrer"
                className="sx-btn-ghost"
                style={{ flex: 1, textDecoration: 'none', fontSize: 12 }}
              >
                🗺 Google Maps
              </a>
            </div>
          </div>
        )}

        {/* Station list */}
        <div className="sx-card-solid" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', background: 'var(--paper-warm)' }}>
            <p className="sx-kicker">
              {viewMode === 'route'
                ? `${routeStations.length} Fuel Stops On Route · Sorted by Route Direction`
                : searchCenter
                  ? `${filteredStations.length} Stations · Sorted by Distance from ${searchCenter.label}`
                  : userLocation
                    ? `${selectedState === 'ALL' ? 'All Stations' : `${selectedState} Stations`} · ${filteredStations.length} locations · Sorted by Distance`
                    : `${selectedState === 'ALL' ? 'All Stations' : `${selectedState} Stations`} · ${filteredStations.length} locations`
              }
            </p>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {filteredStations
              .sort((a, b) => {
                if (viewMode === 'route') {
                  // In route mode, sort by distance from origin (direction of travel)
                  const aMiles = routeDistanceMap.get(a.site) ?? 0
                  const bMiles = routeDistanceMap.get(b.site) ?? 0
                  return aMiles - bMiles
                }
                // Manual location search takes priority over device location
                if (searchCenter && viewMode === 'all') {
                  return milesBetween(searchCenter.lat, searchCenter.lng, a.lat, a.lng) -
                         milesBetween(searchCenter.lat, searchCenter.lng, b.lat, b.lng)
                }
                if (userLocation && viewMode === 'all') {
                  return haversine(userLocation.lat, userLocation.lng, a.lat, a.lng) -
                         haversine(userLocation.lat, userLocation.lng, b.lat, b.lng)
                }
                return a.yourPrice - b.yourPrice
              })
              .map(station => (
                <div
                  key={station.site}
                  onClick={() => {
                    setSelectedStation(station)
                    if (googleMap.current) googleMap.current.panTo({ lat: station.lat, lng: station.lng })
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderBottom: '1px solid var(--line)',
                    cursor: 'pointer',
                    background: selectedStation?.site === station.site ? '#FFF5F5' : 'transparent',
                    transition: 'background var(--t-fast) var(--ease)',
                  }}
                  onMouseEnter={e => {
                    if (selectedStation?.site !== station.site) e.currentTarget.style.background = 'var(--paper-warm)'
                  }}
                  onMouseLeave={e => {
                    if (selectedStation?.site !== station.site) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                      Pilot Travel Center — {station.city}, {station.state}
                    </p>
                    {station.address
                      ? <p style={{ fontSize: 11, color: 'var(--mute-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{station.address}</p>
                      : <p style={{ fontSize: 11, color: 'var(--mute-2)', fontFamily: 'var(--mono)', marginTop: 2 }}>Site #{station.site}</p>
                    }
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 14 }}>
                    <p className="sx-mono" style={{ fontSize: 15, fontWeight: 600, color: 'var(--red)' }}>${station.yourPrice.toFixed(2)}</p>
                    <p className="sx-mono" style={{ fontSize: 11, color: 'var(--green)' }}>Save ${station.savings.toFixed(2)}</p>
                    {viewMode === 'route' && routeDistanceMap.get(station.site) !== undefined && (
                      <p className="sx-mono" style={{ fontSize: 11, color: 'var(--mute)' }}>
                        Mile {(routeDistanceMap.get(station.site) ?? 0).toFixed(0)}
                      </p>
                    )}
                    {viewMode !== 'route' && searchCenter && (
                      <p style={{ fontSize: 11, color: 'var(--mute)' }}>
                        📍 <span className="sx-mono">{milesBetween(searchCenter.lat, searchCenter.lng, station.lat, station.lng).toFixed(1)} mi</span> from {searchCenter.label.split(',')[0]}
                      </p>
                    )}
                    {viewMode !== 'route' && !searchCenter && userLocation && (
                      <p style={{ fontSize: 11, color: 'var(--mute)' }}>
                        📍 <span className="sx-mono">{haversine(userLocation.lat, userLocation.lng, station.lat, station.lng).toFixed(1)} mi</span> from your location
                      </p>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Email Modal */}
      {showEmailModal && (
        <div
          onClick={() => { if (!emailSending) setShowEmailModal(false) }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(11,11,12,0.55)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
            animation: 'sx-fade-in var(--t-base) var(--ease-out)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="sx-card-solid"
            style={{
              padding: 26,
              width: '100%', maxWidth: 460,
              boxShadow: 'var(--sh-xl)',
              border: '1px solid var(--line)',
            }}
          >
            <h3 className="sx-display" style={{ fontSize: 24, color: 'var(--ink)', marginBottom: 6 }}>
              ✉ Email Fuel Plan
            </h3>
            <p style={{ fontSize: 13, color: 'var(--mute)', marginBottom: 20, lineHeight: 1.5 }}>
              Sends a formatted email with the route map, fuel stops, weather forecast, and price highlights.
            </p>
            <label className="sx-kicker" style={{ display: 'block', marginBottom: 8 }}>
              Enter email / Truck # / Driver Code
            </label>
            <input
              type="text"
              value={emailAddress}
              onChange={(e) => {
                const val = e.target.value
                setEmailAddress(val)
                setEmailStatus('')
                const trimmed = val.trim()
                if (!trimmed || trimmed.includes('@')) {
                  setLookupMatches([])
                  setLookupLoading(false)
                  if (lookupTimeoutRef.current) clearTimeout(lookupTimeoutRef.current)
                  return
                }
                setLookupLoading(true)
                if (lookupTimeoutRef.current) clearTimeout(lookupTimeoutRef.current)
                const seq = ++lookupSeqRef.current
                lookupTimeoutRef.current = setTimeout(async () => {
                  try {
                    const res = await fetch(`/api/recipient-lookup?q=${encodeURIComponent(trimmed)}`)
                    const json = await res.json()
                    if (seq === lookupSeqRef.current) {
                      setLookupMatches(json.matches || [])
                      setLookupLoading(false)
                    }
                  } catch {
                    if (seq === lookupSeqRef.current) {
                      setLookupMatches([])
                      setLookupLoading(false)
                    }
                  }
                }, 250)
              }}
              placeholder="Enter email, truck #, or driver code"
              disabled={emailSending}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="sx-input"
              style={{ marginBottom: 12 }}
            />
            {/* Live lookup preview */}
            {lookupLoading && (
              <div style={{ fontSize: 12, color: 'var(--mute)', marginBottom: 10, fontFamily: 'var(--display)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Looking up…</div>
            )}
            {!lookupLoading && emailAddress.trim() && !emailAddress.includes('@') && lookupMatches.length === 0 && (
              <div style={{
                padding: '10px 14px',
                borderRadius: 'var(--r-md)',
                marginBottom: 12,
                background: 'var(--amber-bg)',
                border: '1px solid var(--amber-line)',
                color: '#92400E',
                fontSize: 13,
                fontWeight: 500,
              }}>
                No driver found for that truck # or code. Enter a valid email instead.
              </div>
            )}
            {!lookupLoading && lookupMatches.length >= 1 && (
              <div style={{
                padding: '10px 14px',
                borderRadius: 'var(--r-md)',
                marginBottom: 12,
                background: 'rgba(22,163,74,0.08)',
                border: '1px solid rgba(22,163,74,0.28)',
                color: 'var(--green-deep)',
                fontSize: 13,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>
                  ✓ Found {lookupMatches.length === 1 ? 'driver' : `${lookupMatches.length} drivers`}:
                </div>
                {lookupMatches.map((m, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#15803D' }}>
                    {m.first} {m.last}
                  </div>
                ))}
              </div>
            )}
            {emailStatus && (
              <div style={{
                padding: '12px 14px',
                borderRadius: 'var(--r-md)',
                marginBottom: 14,
                background: emailStatus.startsWith('✓') ? 'rgba(22,163,74,0.08)' : '#FEF2F2',
                border: '1px solid ' + (emailStatus.startsWith('✓') ? 'rgba(22,163,74,0.28)' : '#FECACA'),
                color: emailStatus.startsWith('✓') ? 'var(--green-deep)' : '#991B1B',
                fontSize: 13,
                fontWeight: 500,
              }}>
                {emailStatus}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { if (!emailSending) setShowEmailModal(false) }}
                disabled={emailSending}
                className="sx-btn-ghost"
                style={{
                  flex: 1,
                  opacity: emailSending ? 0.5 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const trimmed = emailAddress.trim()
                  if (!trimmed || !optimizedPlan || optimizedPlan.length === 0) {
                    setEmailStatus('Please enter email, truck #, or driver code')
                    return
                  }
                  let recipients: string[] = []
                  if (trimmed.includes('@')) {
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                      setEmailStatus('Please enter a valid email address')
                      return
                    }
                    recipients = [trimmed]
                  } else if (lookupMatches.length > 0) {
                    recipients = lookupMatches.map(m => m.email)
                  } else {
                    setEmailStatus('No driver matched. Enter a valid email, truck #, or driver code.')
                    return
                  }

                  setEmailSending(true)
                  setEmailStatus('Sending...')
                  try {
                    const promises: Array<Promise<any>> = [
                      fetch('/api/fuel-stats').then(r => r.ok ? r.json() : null).catch(() => null),
                    ]
                    if (originLatLng) {
                      promises.push(
                        fetch(`/api/weather?lat=${originLatLng.lat}&lng=${originLatLng.lng}`).then(r => r.ok ? r.json() : null).catch(() => null)
                      )
                    } else {
                      promises.push(Promise.resolve(null))
                    }
                    if (destLatLng) {
                      promises.push(
                        fetch(`/api/weather?lat=${destLatLng.lat}&lng=${destLatLng.lng}`).then(r => r.ok ? r.json() : null).catch(() => null)
                      )
                    } else {
                      promises.push(Promise.resolve(null))
                    }
                    const [stats, originWx, destWx] = await Promise.all(promises)

                    const weather: any = {}
                    if (originWx?.temp != null) weather.origin = originWx
                    if (destWx?.temp != null) weather.destination = destWx

                    // Send to each resolved recipient
                    const sendResults = await Promise.all(recipients.map(async (toAddr) => {
                      const res = await fetch('/api/fuel-email', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          to: toAddr,
                          origin,
                          destination,
                          distance: routeInfo?.distance || '',
                          duration: routeInfo?.duration || '',
                          stops: optimizedPlan.map(s => ({
                            ...s,
                            exitInfo: routeExitInfo.get(s.station.site) || null,
                          })),
                          routeSummary: routeSummary.length > 0 ? routeSummary : undefined,
                          originLatLng,
                          destLatLng,
                          weather: Object.keys(weather).length > 0 ? weather : undefined,
                          priceStats: stats || undefined,
                          routeAlerts: routeAlerts.length > 0 ? routeAlerts : undefined,
                          viaPoints: viaPoints.filter(v => v.trim()).length > 0 ? viaPoints.filter(v => v.trim()) : undefined,
                          extraMilesFromVias: extraMilesFromVias > 0 ? Math.round(extraMilesFromVias) : undefined,
                          isRoundTrip: viaPoints.some(v => v.trim()) ? isRoundTrip : undefined,
                        }),
                      })
                      const json = await res.json()
                      return { ok: res.ok, json, to: toAddr }
                    }))
                    const failures = sendResults.filter(r => !r.ok)
                    if (failures.length === 0) {
                      setEmailStatus(recipients.length === 1
                        ? '✓ Email sent successfully!'
                        : `✓ Sent to ${recipients.length} recipients!`)
                      setTimeout(() => { setShowEmailModal(false); setEmailStatus(''); setEmailAddress(''); setLookupMatches([]); }, 1800)
                    } else {
                      setEmailStatus(`Error: ${failures[0].json.error || 'Failed to send'}`)
                    }
                  } catch (err: any) {
                    setEmailStatus(`Error: ${err.message || 'Failed to send'}`)
                  } finally {
                    setEmailSending(false)
                  }
                }}
                disabled={emailSending || !emailAddress.trim() || (lookupLoading) || (!emailAddress.includes('@') && lookupMatches.length === 0 && emailAddress.trim().length > 0)}
                style={{
                  flex: 2,
                  padding: '14px 24px',
                  background: emailSending
                    ? 'var(--mute)'
                    : 'linear-gradient(180deg, #3B82F6 0%, #2563EB 60%, #1D4ED8 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--r-pill)',
                  cursor: emailSending ? 'wait' : 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: 'var(--display)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  boxShadow: emailSending ? 'var(--sh-sm)' : '0 4px 12px rgba(37,99,235,0.32), 0 10px 28px rgba(37,99,235,0.20), inset 0 1px 0 rgba(255,255,255,0.10)',
                  opacity: (emailSending || !emailAddress.trim() || (!emailAddress.includes('@') && lookupMatches.length === 0 && emailAddress.trim().length > 0)) ? 0.6 : 1,
                  transition: 'all var(--t-base) var(--ease)',
                }}
              >
                {emailSending ? 'Sending...' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
