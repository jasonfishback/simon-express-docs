import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { findRecipient, getTimeOfDayGreeting, getTodaysDateFormatted } from '@/lib/recipients'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const resend = new Resend(process.env.RESEND_API_KEY)

interface Stop {
  station: {
    site: string
    city: string
    state: string
    yourPrice: number
    savings: number
    lat: number
    lng: number
    description?: string
    interstate?: string
    parking?: number
    dieselLanes?: number
    dieselDefLanes?: number
    showers?: number
    address?: string
    zip?: string
    phone?: string
    catScale?: boolean
    facilities?: string
  }
  gallons: number
  milesFromOrigin: number
  cost: number
  savings: number
  detour?: number
  exitInfo?: string | null
  resultsInFullTank?: boolean
}

interface WeatherReport {
  temp: number | null
  feelsLike?: number | null
  minTemp?: number | null
  maxTemp?: number | null
  condition: string | null
  conditionType?: string | null
  iconUri?: string | null
  windSpeedMph?: number | null
  windGustMph?: number | null
  windDirection?: string | null
  precipitationProbability?: number | null
  precipitationType?: string | null
  humidity?: number | null
  visibilityMiles?: number | null
  cloudCover?: number | null
  isDaytime?: boolean | null
}

interface EmailRequest {
  to: string
  origin: string
  destination: string
  distance: string
  duration: string
  stops: Stop[]
  originLatLng?: { lat: number, lng: number }
  destLatLng?: { lat: number, lng: number }
  weather?: {
    origin?: WeatherReport
    destination?: WeatherReport
  }
  priceStats?: {
    highest: Array<{ state: string, avgPrice: number }>
    lowest: Array<{ state: string, avgPrice: number }>
  }
  avoidTolls?: boolean
  routeAlerts?: Array<{ severity: 'warning' | 'info', title: string, detail?: string }>
  routeSummary?: Array<{ road: string, miles: number, exitNote?: string }>
  viaPoints?: string[]
  extraMilesFromVias?: number
  isRoundTrip?: boolean
}

export async function POST(req: NextRequest) {
  try {
    const body: EmailRequest = await req.json()
    const { to, origin, destination, distance, duration, stops, originLatLng, destLatLng, weather, priceStats, avoidTolls, routeAlerts, routeSummary, viaPoints, extraMilesFromVias, isRoundTrip } = body

    if (!to || !stops || stops.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const totalGals = stops.reduce((s, p) => s + p.gallons, 0)
    const totalCost = stops.reduce((s, p) => s + p.cost, 0)
    const totalSav = stops.reduce((s, p) => s + p.savings, 0)

    // Personalization based on recipient lookup
    const recipient = findRecipient(to)
    const greetingTimePrefix = getTimeOfDayGreeting()
    // Use handle if present, otherwise first name, otherwise just "there"
    const greetingName = recipient
      ? (recipient.handle && recipient.handle.trim() ? recipient.handle.trim() : recipient.first)
      : null
    const greeting = greetingName ? `${greetingTimePrefix} ${greetingName},` : `${greetingTimePrefix},`
    const fullName = recipient ? `${recipient.first} ${recipient.last}` : null
    const todayFormatted = getTodaysDateFormatted()

    // Parse "City, STATE" out of the origin/destination strings for the body intro
    const shortPlace = (addr: string) => {
      // Take first two comma-separated parts (City, State)
      const parts = addr.split(',').map(p => p.trim()).filter(Boolean)
      if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`
      return addr
    }
    const originShort = shortPlace(origin)
    const destShort = shortPlace(destination)

    // Build Google Static Maps URL with route and fuel stop markers
    const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    let mapImageUrl = ''
    if (mapsKey && originLatLng && destLatLng) {
      // Fetch the actual routed path from Directions API so the map shows the real road path
      let encodedPolyline: string | null = null
      try {
        const waypointsParam = viaPoints && viaPoints.length > 0
          ? `&waypoints=${viaPoints.map(v => encodeURIComponent(v)).join('|')}`
          : ''
        const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLatLng.lat},${originLatLng.lng}&destination=${destLatLng.lat},${destLatLng.lng}${waypointsParam}&avoid=tolls&key=${mapsKey}`
        const dRes = await fetch(directionsUrl)
        if (dRes.ok) {
          const dData = await dRes.json()
          if (dData.status === 'OK' && dData.routes?.[0]?.overview_polyline?.points) {
            encodedPolyline = dData.routes[0].overview_polyline.points
          }
        }
      } catch (e) {
        console.error('Directions API error for email map:', e)
      }

      const params: string[] = []
      params.push('size=640x360')
      params.push('scale=2')
      params.push('maptype=roadmap')
      // Origin marker (green)
      params.push(`markers=color:green|label:A|${originLatLng.lat},${originLatLng.lng}`)
      // Destination marker (red)
      params.push(`markers=color:red|label:B|${destLatLng.lat},${destLatLng.lng}`)
      // Fuel stop markers (blue, numbered)
      stops.forEach((stop, i) => {
        const num = i + 1
        params.push(`markers=color:blue|label:${num}|${stop.station.lat},${stop.station.lng}`)
      })
      if (encodedPolyline) {
        // Use Google's encoded polyline (real road path) — prefix with "enc:"
        params.push(`path=color:0x0066ccff|weight:4|enc:${encodedPolyline}`)
      } else {
        // Fallback: straight-line path
        const path = [
          `${originLatLng.lat},${originLatLng.lng}`,
          ...stops.map(s => `${s.station.lat},${s.station.lng}`),
          `${destLatLng.lat},${destLatLng.lng}`
        ].join('|')
        params.push(`path=color:0x0066ccff|weight:4|${path}`)
      }
      params.push(`key=${mapsKey}`)
      mapImageUrl = `https://maps.googleapis.com/maps/api/staticmap?${params.join('&')}`
    }

    // Build the HTML email
    const stopRows = stops.map((stop, i) => {
      const displayAsFull = !!stop.resultsInFullTank
      const fillLabel = displayAsFull ? 'Fill to 100%' : `${stop.gallons} gal`
      const badge = displayAsFull
        ? '<span style="background:#CC0000;color:#fff;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;letter-spacing:0.5px;">FULL</span>'
        : `<span style="background:#f3d9a4;color:#996515;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;">PARTIAL · ${Math.round((stop.gallons/240)*100)}%</span>`
      const detourBadge = stop.detour && stop.detour > 0
        ? `<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:3px;font-size:10px;margin-left:6px;">+${stop.detour.toFixed(1)}mi detour</span>`
        : ''
      // Clickable station name — uses exact lat/lng coordinates so it opens the PRECISE station
      // location. Use the ACTUAL STREET ADDRESS in the query so Google Maps geocodes and routes
      // to the exact building — not just a pin at lat/lng coordinates.
      const stationLabel = stop.station.description || 'Pilot Travel Center'
      let mapsUrl: string
      if (stop.station.address && stop.station.address.trim()) {
        const fullAddress = [stop.station.address, stop.station.city, stop.station.state, stop.station.zip].filter(Boolean).join(', ')
        mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`
      } else {
        // Fall back to station label if no street address available
        mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stationLabel + ' ' + stop.station.city + ', ' + stop.station.state)}`
      }
      const stationNameLink = `<a href="${mapsUrl}" style="color:#CC0000;text-decoration:none;border-bottom:1px dotted #CC0000;" target="_blank">${stationLabel} — ${stop.station.city}, ${stop.station.state}</a>`
      // Prefer interstate from amenities data if no Directions API exit info
      const interstateLine = stop.exitInfo || stop.station.interstate || ''
      const locationLine = interstateLine
        ? `<strong style="color:#111;">${interstateLine}</strong>`
        : ''
      // Build compact amenities line (only show populated fields)
      const amenityItems: string[] = []
      if (stop.station.parking != null) amenityItems.push(`🅿️ ${stop.station.parking}`)
      if (stop.station.dieselLanes != null) amenityItems.push(`⛽ ${stop.station.dieselLanes} lanes`)
      if (stop.station.showers != null) amenityItems.push(`🚿 ${stop.station.showers}`)
      if (stop.station.catScale === true) amenityItems.push(`⚖️ CAT`)
      const amenitiesLine = amenityItems.length > 0
        ? `<div style="font-size:11px;color:#666;margin-top:4px;">${amenityItems.join(' · ')}</div>`
        : ''
      const facilitiesLine = stop.station.facilities
        ? `<div style="font-size:11px;color:#854d0e;margin-top:3px;font-style:italic;">🍔 ${stop.station.facilities}</div>`
        : ''
      return `
        <tr>
          <td style="padding:14px 12px;border-bottom:1px solid #eee;vertical-align:top;">
            <div style="display:inline-block;width:28px;height:28px;background:#111;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:14px;">${i+1}</div>
          </td>
          <td style="padding:14px 12px;border-bottom:1px solid #eee;vertical-align:top;">
            <div style="font-size:15px;font-weight:700;margin-bottom:3px;line-height:1.3;">
              ${stationNameLink}
            </div>
            ${(locationLine || detourBadge) ? `<div style="font-size:12px;color:#666;margin-bottom:6px;">
              ${locationLine}${detourBadge}
            </div>` : ''}
            <div style="font-size:13px;color:#333;">
              <strong style="color:#CC0000;font-size:16px;">${fillLabel}</strong> &nbsp; ${badge}<br/>
              <span style="color:#666;">Stop cost: $${stop.cost.toFixed(2)}</span>
            </div>
            ${amenitiesLine}
            ${facilitiesLine}
          </td>
          <td style="padding:14px 12px;border-bottom:1px solid #eee;vertical-align:top;text-align:right;">
            <div style="font-size:18px;font-weight:800;color:#111;line-height:1;">$${stop.station.yourPrice.toFixed(2)}</div>
            <div style="font-size:10px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-top:2px;">per gal</div>
            <div style="font-size:12px;color:#16a34a;font-weight:600;margin-top:6px;">Save $${stop.savings.toFixed(2)}</div>
            <div style="font-size:11px;color:#16a34a;margin-top:1px;">${(stop.station.savings / 6 * 100).toFixed(1)}¢/mi off pump</div>
          </td>
        </tr>`
    }).join('')

    // Weather section
    // Weather section with rich report + optional alerts
    let weatherHtml = ''
    const hasWeather = weather && (weather.origin || weather.destination)
    const hasAlerts = routeAlerts && routeAlerts.length > 0
    if (hasWeather || hasAlerts) {
      // Renders a single weather card (origin or destination) — temp, condition, H/L only
      const weatherCard = (label: string, w: WeatherReport | undefined): string => {
        if (!w) return ''
        const tempStr = w.temp != null ? `${Math.round(w.temp)}°F` : '—'
        const hiLo = (w.minTemp != null && w.maxTemp != null) ? `H ${Math.round(w.maxTemp)}° / L ${Math.round(w.minTemp)}°` : ''
        return `
          <td style="width:50%;padding:0;vertical-align:top;">
            <div style="padding:16px;background:#f8f9fa;border-radius:10px;height:100%;box-sizing:border-box;">
              <div style="font-size:10px;color:#666;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">${label}</div>
              <div style="font-size:34px;font-weight:800;color:#111;line-height:1;">${tempStr}</div>
              <div style="font-size:12px;color:#555;margin-top:4px;">${w.condition || ''}</div>
              ${hiLo ? `<div style="font-size:11px;color:#888;margin-top:2px;">${hiLo}</div>` : ''}
            </div>
          </td>`
      }

      const cells: string[] = []
      if (weather?.origin) cells.push(weatherCard('Origin', weather.origin))
      if (weather?.destination) cells.push(weatherCard('Destination', weather.destination))
      // If only one cell, pad with empty to keep layout stable
      if (cells.length === 1) cells.push('<td style="width:50%;"></td>')

      const weatherCellsHtml = cells.length > 0 ? `
        <table width="100%" cellpadding="0" cellspacing="8" style="border-collapse:separate;margin-bottom:${hasAlerts ? '12px' : '0'};">
          <tr>${cells.join('')}</tr>
        </table>` : ''

      let alertsBlock = ''
      if (hasAlerts) {
        const alertItems = routeAlerts!.map(a =>
          `<div style="padding:10px 12px;background:#fff;border-left:4px solid #dc2626;border-radius:4px;margin-bottom:6px;">
            <div style="font-size:14px;font-weight:700;color:#991b1b;line-height:1.3;">${a.title}</div>
            ${a.detail ? `<div style="font-size:12px;color:#7f1d1d;margin-top:3px;">${a.detail}</div>` : ''}
          </div>`
        ).join('')
        alertsBlock = `
          <div style="padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;">
            <div style="font-family:Barlow Condensed,sans-serif;font-size:12px;font-weight:800;letter-spacing:2px;color:#991b1b;text-transform:uppercase;margin-bottom:10px;">
              ⚠️ Route Alerts (${routeAlerts!.length})
            </div>
            ${alertItems}
            <div style="font-size:11px;color:#991b1b;margin-top:8px;font-style:italic;">
              Please drive with extra caution. Check local DOT updates before departing.
            </div>
          </div>`
      }

      weatherHtml = `
        <tr><td style="padding:24px 24px 0 24px;">
          <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Weather Report</div>
          ${weatherCellsHtml}
          ${alertsBlock}
        </td></tr>`
    }

    // Fuel price stats section
    let statsHtml = ''
    if (priceStats && (priceStats.highest?.length || priceStats.lowest?.length)) {
      const highRows = priceStats.highest.slice(0, 5).map((s, i) =>
        `<tr><td style="padding:5px 0;color:#666;font-size:12px;">${i+1}. ${s.state}</td><td style="padding:5px 0;text-align:right;font-size:13px;font-weight:700;color:#dc2626;">$${s.avgPrice.toFixed(2)}</td></tr>`
      ).join('')
      const lowRows = priceStats.lowest.slice(0, 5).map((s, i) =>
        `<tr><td style="padding:5px 0;color:#666;font-size:12px;">${i+1}. ${s.state}</td><td style="padding:5px 0;text-align:right;font-size:13px;font-weight:700;color:#16a34a;">$${s.avgPrice.toFixed(2)}</td></tr>`
      ).join('')
      statsHtml = `
        <tr><td style="padding:24px 24px 0 24px;">
          <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Pilot Fuel Price Snapshot</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="width:50%;padding:14px;background:#fef2f2;border-radius:8px;vertical-align:top;">
                <div style="font-size:11px;color:#991b1b;font-weight:700;margin-bottom:8px;letter-spacing:0.5px;">▲ HIGHEST STATES</div>
                <table width="100%" cellpadding="0" cellspacing="0">${highRows}</table>
              </td>
              <td style="width:10px;"></td>
              <td style="width:50%;padding:14px;background:#f0fdf4;border-radius:8px;vertical-align:top;">
                <div style="font-size:11px;color:#166534;font-weight:700;margin-bottom:8px;letter-spacing:0.5px;">▼ LOWEST STATES</div>
                <table width="100%" cellpadding="0" cellspacing="0">${lowRows}</table>
              </td>
            </tr>
          </table>
        </td></tr>`
    }

    const mapHtml = mapImageUrl ? `
      <tr><td style="padding:20px 24px 0 24px;">
        <img src="${mapImageUrl}" alt="Route map" width="100%" style="display:block;width:100%;max-width:560px;border-radius:8px;border:1px solid #e5e5e5;"/>
      </td></tr>` : ''

    // Route summary narrative — major highways taken
    let routeSummaryHtml = ''
    if (routeSummary && routeSummary.length > 0) {
      const items = routeSummary.map((seg, i) => {
        const isLast = i === routeSummary.length - 1
        return `
          <div style="display:flex;align-items:center;padding:8px 0;${!isLast ? 'border-bottom:1px solid #eee;' : ''}">
            <div style="display:inline-block;width:6px;height:6px;background:#CC0000;border-radius:50%;margin-right:10px;flex-shrink:0;"></div>
            <div style="flex:1;">
              <span style="font-size:14px;font-weight:700;color:#111;">${seg.road}</span>
              <span style="font-size:12px;color:#666;"> for ${Math.round(seg.miles)}mi</span>
              ${seg.exitNote ? `<div style="font-size:11px;color:#92400e;margin-top:2px;">→ ${seg.exitNote}</div>` : ''}
            </div>
          </div>`
      }).join('')
      routeSummaryHtml = `
        <tr><td style="padding:16px 24px 0 24px;">
          <div style="padding:12px 14px;background:#fafafa;border:1px solid #eee;border-radius:8px;">
            <div style="font-size:10px;color:#888;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Route Summary</div>
            ${items}
          </div>
        </td></tr>`
    }

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Simon Express Fuel Plan</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px 10px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr><td style="background:#111;padding:24px;text-align:center;border-bottom:4px solid #CC0000;">
        <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:1px;">SIMON EXPRESS</div>
        <div style="color:#888;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-top:4px;">Optimized Fuel Plan</div>
      </td></tr>

      <!-- Savings Banner -->
      <tr><td style="background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);background-color:#16a34a;padding:20px 24px;text-align:center;">
        <div style="color:rgba(255,255,255,0.9);font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Total Savings on This Route</div>
        <div style="color:#fff;font-size:38px;font-weight:800;line-height:1;letter-spacing:-1px;">$${totalSav.toFixed(2)}</div>
        <div style="color:rgba(255,255,255,0.85);font-size:12px;margin-top:6px;">vs. retail pump price across ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}</div>
      </td></tr>

      <!-- Greeting -->
      <tr><td style="padding:24px 24px 0 24px;">
        <div style="font-size:16px;color:#111;line-height:1.55;">
          <strong>${greeting}</strong>
        </div>
        <div style="font-size:14px;color:#444;line-height:1.6;margin-top:8px;">
          Here is your customized fuel route for <strong>${originShort}</strong> to <strong>${destShort}</strong> based on your search.
        </div>
      </td></tr>

      <!-- Route Summary -->
      <tr><td style="padding:24px 24px 8px 24px;">
        <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Route</div>
        <div style="font-size:16px;color:#111;font-weight:600;line-height:1.5;">
          ${origin}<br/>
          ${viaPoints && viaPoints.length > 0 ? viaPoints.map(vp => `
            <span style="color:#999;">↓</span><br/>
            <span style="color:#92400e;background:#fef3c7;padding:2px 10px;border-radius:4px;font-size:14px;font-weight:600;">🔶 ${vp}</span><br/>`).join('') : ''}
          <span style="color:#999;">↓</span><br/>
          ${destination}
        </div>
        <div style="font-size:13px;color:#666;margin-top:10px;">
          ${distance} · ${duration} · <span style="color:#92400e;font-weight:700;">🚫 No Tolls</span>
        </div>
        ${viaPoints && viaPoints.length > 0 ? (isRoundTrip ? `
          <div style="margin-top:10px;padding:10px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:7px;font-size:13px;color:#166534;font-weight:600;">
            🔄 <strong>This route includes stops for round trip</strong>
          </div>
        ` : (extraMilesFromVias && extraMilesFromVias > 0 ? `
          <div style="margin-top:10px;padding:10px 14px;background:#fef3c7;border:1px solid #fcd34d;border-radius:7px;font-size:13px;color:#92400e;font-weight:600;">
            ➕ <strong>${extraMilesFromVias} miles added</strong> by ${viaPoints.length === 1 ? 'extra stop' : `${viaPoints.length} extra stops`} (vs. direct route)
          </div>
        ` : '')) : ''}
      </td></tr>

      ${mapHtml}

      ${routeSummaryHtml}

      <!-- Stops Table -->
      <tr><td style="padding:20px 24px 0 24px;">
        <div style="font-size:11px;color:#888;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">${stops.length} ${stops.length === 1 ? 'Fuel Stop' : 'Fuel Stops'}</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden;">
          ${stopRows}
          <tr>
            <td colspan="2" style="padding:18px 14px;background:#111;color:#fff;vertical-align:middle;">
              <div style="font-size:10px;color:#888;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Total Cost</div>
              <div style="font-size:15px;font-weight:700;color:#fff;line-height:1;">$${totalCost.toFixed(2)}</div>
              <div style="font-size:11px;color:#888;margin-top:4px;">${totalGals} gal</div>
            </td>
            <td style="padding:18px 14px;background:#111;color:#fff;text-align:right;vertical-align:middle;">
              <div style="font-size:10px;color:#888;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Total Savings</div>
              <div style="font-size:28px;font-weight:800;color:#22c55e;line-height:1;letter-spacing:-0.5px;">$${totalSav.toFixed(2)}</div>
            </td>
          </tr>
        </table>
      </td></tr>

      ${weatherHtml}

      ${statsHtml}

      <!-- You Did That - thank you section -->
      <tr><td style="padding:24px 24px 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fafafa;border-radius:10px;">
          <tr>
            <td style="padding:16px 18px;vertical-align:middle;width:100px;">
              <img src="https://docs.simonexpress.com/youdidthat.png" alt="You Did That" width="90" style="display:block;width:90px;height:auto;border:0;"/>
            </td>
            <td style="padding:16px 18px 16px 4px;vertical-align:middle;">
              <p style="margin:0;font-size:13px;color:#111;line-height:1.5;font-weight:500;">
                By fueling at the stations with the lowest prices you are helping us get our <strong style="color:#16a34a;">$${totalSav.toFixed(2)}</strong> in discounts.
              </p>
              <p style="margin:6px 0 0 0;font-size:12px;color:#666;font-style:italic;">
                — Thank you from everyone at Simon Express!
              </p>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:28px 24px 24px 24px;text-align:center;">
        <div style="font-size:11px;color:#999;letter-spacing:1px;">
          Generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Denver' })} MT
        </div>
        <div style="font-size:10px;color:#bbb;margin-top:8px;">
          © Simon Express LLC · docs.simonexpress.com
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`

    const plainTextGreeting = greetingName
      ? `${greetingTimePrefix} ${greetingName},\n\nHere is your customized fuel route for ${originShort} to ${destShort} based on your search.\n\n`
      : `${greetingTimePrefix},\n\nHere is your customized fuel route for ${originShort} to ${destShort} based on your search.\n\n`

    const plainText = plainTextGreeting +
      `SIMON EXPRESS FUEL PLAN\n${origin} -> ${destination}\n${distance} / ${duration}\n\n${stops.length} ${stops.length === 1 ? 'STOP' : 'STOPS'}:\n` +
      stops.map((stop, i) => {
        const label = stop.resultsInFullTank ? 'FULL' : `${Math.round((stop.gallons/240)*100)}%`
        const gallonsText = stop.resultsInFullTank ? 'Fill to 100%' : `${stop.gallons} gal`
        return `\n${i+1}. ${stop.station.city}, ${stop.station.state} (Mi ${stop.milesFromOrigin.toFixed(0)})\n   Fill: ${gallonsText} [${label}] @ $${stop.station.yourPrice.toFixed(2)}/gal\n   Cost: $${stop.cost.toFixed(2)} | Save: $${stop.savings.toFixed(2)}`
      }).join('\n') +
      `\n\nTOTAL: ${totalGals} gal | $${totalCost.toFixed(2)}\nTOTAL SAVINGS: $${totalSav.toFixed(2)}`

    const fromEmail = 'Simon Express Dispatch <dispatch@simonexpress.com>'
    // Extract state (2-letter code) from an address like "Denver, CO, USA" or "Salt Lake City, UT"
    const US_STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'])
    const extractState = (addr: string): string => {
      const parts = addr.split(',').map(p => p.trim()).filter(Boolean)
      // Look backwards for a 2-letter US state code (possibly with zip attached like "UT 84101")
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        // "UT" or "UT 84101" — take first token
        const firstToken = p.split(/\s+/)[0].toUpperCase()
        if (US_STATES.has(firstToken)) return firstToken
      }
      // Fallback: last non-country part
      return parts[parts.length - 1] || addr
    }
    const originState = extractState(origin)
    const destState = extractState(destination)

    // Build subject: "Fuel Plan [date] - [state] to [state]" + optional "- [name]"
    const subjectBase = `Fuel Plan ${todayFormatted} - ${originState} to ${destState}`
    const subject = fullName ? `${subjectBase} - ${fullName}` : subjectBase

    const DISPATCH_EMAIL = 'dispatch@simonexpress.com'
    const isDispatchRecipient = to.trim().toLowerCase() === DISPATCH_EMAIL

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      ...(isDispatchRecipient ? {} : { bcc: [DISPATCH_EMAIL] }),
      subject,
      html,
      text: plainText,
    })

    if (error) {
      console.error('Resend error:', error)
      return NextResponse.json({ error: 'Failed to send email', details: error }, { status: 500 })
    }

    // Log this send for the daily dispatch report (best-effort, never blocks the response)
    try {
      const { appendUsage } = await import('@/lib/usage-log')
      const totalMiles = (() => {
        const m = /([\d,]+)\s*mi/i.exec(distance || '')
        if (m) return parseInt(m[1].replace(/,/g, ''), 10) || 0
        return 0
      })()
      await appendUsage({
        timestamp: new Date().toISOString(),
        recipientEmail: to.trim().toLowerCase(),
        recipientName: fullName || undefined,
        truckNumber: recipient?.truckNumber != null ? String(recipient.truckNumber) : undefined,
        origin,
        destination,
        miles: totalMiles,
        gallons: totalGals,
        cost: totalCost,
        savings: totalSav,
        stopCount: stops.length,
      })
    } catch (logErr) {
      console.error('Usage log append failed (non-fatal):', logErr)
    }

    return NextResponse.json({ success: true, id: data?.id })
  } catch (err: any) {
    console.error('Email route error:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
