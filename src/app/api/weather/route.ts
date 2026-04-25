import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 10
export const dynamic = 'force-dynamic'

// Google Weather API - returns current conditions
// Docs: https://developers.google.com/maps/documentation/weather/current-conditions
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const lat = searchParams.get('lat')
    const lng = searchParams.get('lng')
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY

    if (!lat || !lng) {
      return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 })
    }
    if (!key) {
      return NextResponse.json({ error: 'Missing API key' }, { status: 500 })
    }

    const url = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${key}&location.latitude=${lat}&location.longitude=${lng}&unitsSystem=IMPERIAL`
    const res = await fetch(url)

    if (!res.ok) {
      const text = await res.text()
      console.error('Google Weather API error:', res.status, text)
      return NextResponse.json({ error: 'Weather API failed', status: res.status, detail: text }, { status: res.status })
    }

    const data = await res.json()
    // Extract useful fields for the rich weather report
    const temp = data.temperature?.degrees ?? null
    const feelsLike = data.feelsLikeTemperature?.degrees ?? null
    const minTemp = data.currentConditionsHistory?.minTemperature?.degrees ?? null
    const maxTemp = data.currentConditionsHistory?.maxTemperature?.degrees ?? null
    const condition = data.weatherCondition?.description?.text ?? data.weatherCondition?.type ?? null
    const conditionType = data.weatherCondition?.type ?? null
    const iconUri = data.weatherCondition?.iconBaseUri ?? null
    const windSpeedMph = data.wind?.speed?.value ?? null
    const windGustMph = data.wind?.gust?.value ?? null
    const windDirection = data.wind?.direction?.cardinal ?? null
    const precipitationProbability = data.precipitation?.probability?.percent ?? null
    const precipitationType = data.precipitation?.probability?.type ?? null
    const humidity = data.relativeHumidity ?? null
    const visibilityMiles = data.visibility?.distance ?? null
    const cloudCover = data.cloudCover ?? null
    const isDaytime = data.isDaytime ?? null

    return NextResponse.json({
      temp,
      feelsLike,
      minTemp,
      maxTemp,
      condition,
      conditionType,
      iconUri,
      windSpeedMph,
      windGustMph,
      windDirection,
      precipitationProbability,
      precipitationType,
      humidity,
      visibilityMiles,
      cloudCover,
      isDaytime,
    })
  } catch (err: any) {
    console.error('Weather route error:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
