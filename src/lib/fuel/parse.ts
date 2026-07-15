import * as XLSX from 'xlsx'

// Brand keys carried on every station in fuel-data.json. Legacy blobs
// (pre-multibrand) have no brand field — consumers treat missing as 'pfj'.
export type FuelBrand = 'pfj' | 'loves' | 'ta'

export interface ParsedStation {
  brand: FuelBrand
  site: string
  /** Display name from the source file when it has one (TA). Others get a
   *  brand default during enrichment. */
  name?: string
  city: string
  state: string
  retailPrice: number
  yourPrice: number
  savings: number
}

function sheetRows(buffer: Buffer, preferredSheet?: string): any[][] {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const name =
    (preferredSheet && wb.SheetNames.find(n => n.toLowerCase() === preferredSheet.toLowerCase())) ||
    wb.SheetNames[0]
  return XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, raw: true, defval: null })
}

// Find the row whose cells contain every one of `labels` (case-insensitive,
// trimmed), and return { row index, column index per label }.
function findHeader(rows: any[][], labels: string[]): { row: number; cols: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = (rows[i] || []).map(c => String(c ?? '').trim().toLowerCase())
    const cols: Record<string, number> = {}
    let ok = true
    for (const label of labels) {
      const idx = cells.indexOf(label.toLowerCase())
      if (idx < 0) { ok = false; break }
      cols[label] = idx
    }
    if (ok) return { row: i, cols }
  }
  return null
}

function num(v: any): number {
  const n = Number(v)
  return isFinite(n) ? n : NaN
}

// ── Pilot / Flying J ────────────────────────────────────────────────────────
// Daily "Pricing - Pilot Flying J" email from DailyPricing@pilotflyingj.com.
// Header row 5-ish: Site / City / ST / <product> ... retail col 17, discounted
// col 19, savings col 20. Non-DSL rows filtered.
export function parsePilotXls(buffer: Buffer): ParsedStation[] {
  const rows = sheetRows(buffer)
  const header = findHeader(rows, ['Site', 'City', 'ST'])
  if (!header) throw new Error('Could not find header row (Site / City / ST) in Pilot xls')
  const stations: ParsedStation[] = []
  for (let i = header.row + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const site = r[header.cols['Site']]
    const city = r[header.cols['City']]
    const state = r[header.cols['ST']]
    const prod = r[3]
    if (site == null || city == null || state == null) continue
    if (prod != null && String(prod).trim().toUpperCase() !== 'DSL') continue
    const yours = num(r[19])
    if (!(yours > 0)) continue
    stations.push({
      brand: 'pfj',
      site: String(site).trim(),
      city: String(city).trim(),
      state: String(state).trim().toUpperCase(),
      retailPrice: num(r[17]) > 0 ? num(r[17]) : 0,
      yourPrice: yours,
      savings: isFinite(num(r[20])) ? num(r[20]) : 0,
    })
  }
  return stations
}

// ── Love's ─────────────────────────────────────────────────────────────────
// "CP Loves Forecast MM.DD.YY ... .xlsx" from the England Logistics daily
// email — sheet "LovesPrices":
//   Loves Store No. | City | State | Retail Price | Disc. Price | Total Savings
export function parseLovesXlsx(buffer: Buffer): ParsedStation[] {
  const rows = sheetRows(buffer, 'LovesPrices')
  const header = findHeader(rows, ['Loves Store No.', 'City', 'State', 'Retail Price', 'Disc. Price'])
  if (!header) throw new Error('Could not find header row (Loves Store No. / City / State ...) in Loves xlsx')
  const savingsCol = findHeader(rows, ['Total Savings'])?.cols['Total Savings'] ?? -1
  const stations: ParsedStation[] = []
  for (let i = header.row + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const site = r[header.cols['Loves Store No.']]
    const city = r[header.cols['City']]
    const state = r[header.cols['State']]
    if (site == null || city == null || state == null) continue
    const yours = num(r[header.cols['Disc. Price']])
    if (!(yours > 0)) continue
    stations.push({
      brand: 'loves',
      site: String(site).trim(),
      city: String(city).trim(),
      state: String(state).trim().toUpperCase(),
      retailPrice: num(r[header.cols['Retail Price']]) > 0 ? num(r[header.cols['Retail Price']]) : 0,
      yourPrice: yours,
      savings: savingsCol >= 0 && isFinite(num(r[savingsCol])) ? num(r[savingsCol]) : 0,
    })
  }
  return stations
}

// ── TA / Petro / TA Express ────────────────────────────────────────────────
// "TAPetro_PRICES ... .xls" from the same England email — sheet "Pricing":
//   Type | # | Travel Center | ST | Retail Price | Carrier Disc Price | Total Savings
// There is no city column; the Travel Center name embeds it
// ("TA EXPRESS - BIRMINGHAM", "PETRO SHORTER", "TA TUSCALOOSA").
export function parseTaXls(buffer: Buffer): ParsedStation[] {
  const rows = sheetRows(buffer, 'Pricing')
  const header = findHeader(rows, ['#', 'Travel Center', 'ST', 'Retail Price', 'Carrier Disc Price'])
  if (!header) throw new Error('Could not find header row (# / Travel Center / ST ...) in TA xls')
  const savingsCol = findHeader(rows, ['Total Savings'])?.cols['Total Savings'] ?? -1
  // The sheet occasionally contains exact duplicate rows (16 on 7/15) —
  // keyed by site so each station appears once.
  const bySite = new Map<string, ParsedStation>()
  for (let i = header.row + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const site = r[header.cols['#']]
    const rawName = r[header.cols['Travel Center']]
    const state = r[header.cols['ST']]
    if (site == null || rawName == null || state == null) continue
    const yours = num(r[header.cols['Carrier Disc Price']])
    if (!(yours > 0)) continue
    // Occasional junk like "487PETRO MEBANE" — strip stray leading digits.
    const name = String(rawName).trim().replace(/^\d+\s*/, '')
    const city = name.replace(/^(TA EXPRESS|PETRO|TA)\s*-?\s*/i, '').trim()
    const key = String(site).trim()
    if (bySite.has(key)) continue
    bySite.set(key, {
      brand: 'ta',
      site: key,
      name,
      city: city || name,
      state: String(state).trim().toUpperCase(),
      retailPrice: num(r[header.cols['Retail Price']]) > 0 ? num(r[header.cols['Retail Price']]) : 0,
      yourPrice: yours,
      savings: savingsCol >= 0 && isFinite(num(r[savingsCol])) ? num(r[savingsCol]) : 0,
    })
  }
  return Array.from(bySite.values())
}
