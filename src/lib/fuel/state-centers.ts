// Fallback geographic centers for each US state.
// Used when a station appears in pricing data but has no entry in station-coords.json
// (i.e. a brand-new Pilot location that hasn't been added to the cache yet).
// Better than dropping the station entirely — it'll show up at roughly the right place
// on the map and can still match corridor searches in that state.

export const STATE_CENTERS: Record<string, [number, number]> = {
  AL: [32.81, -86.79], AR: [34.97, -92.37], AZ: [33.73, -111.43],
  CA: [36.12, -119.68], CO: [39.06, -105.31], CT: [41.60, -72.76],
  FL: [27.77, -81.69], GA: [33.04, -83.64], IA: [42.01, -93.21],
  ID: [44.24, -114.48], IL: [40.35, -88.99], IN: [39.85, -86.26],
  KS: [38.53, -96.73], KY: [37.67, -84.67], LA: [31.17, -91.87],
  MA: [42.23, -71.53], MD: [39.06, -76.80], MI: [43.33, -84.54],
  MN: [45.69, -93.90], MO: [38.46, -92.29], MS: [32.74, -89.68],
  MT: [46.92, -110.45], NC: [35.63, -79.81], ND: [47.53, -99.78],
  NE: [41.13, -98.27], NJ: [40.30, -74.52], NM: [34.84, -106.25],
  NV: [38.31, -117.06], NY: [42.17, -74.95], OH: [40.39, -82.76],
  OK: [35.57, -96.93], OR: [44.57, -122.07], PA: [40.59, -77.21],
  SC: [33.86, -80.95], SD: [44.30, -99.44], TN: [35.75, -86.69],
  TX: [31.05, -97.56], UT: [40.15, -111.86], VA: [37.77, -78.17],
  WA: [47.40, -121.49], WI: [44.27, -89.62], WV: [38.49, -80.95],
  WY: [42.76, -107.30],
}

// Continental US center — last-resort fallback if even the state code is unrecognized
export const US_CENTER: [number, number] = [39.5, -98.35]
