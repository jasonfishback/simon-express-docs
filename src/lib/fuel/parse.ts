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
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, raw: true, defval: null })
  // Vendor files occasionally move the data to a differently-named sheet while
  // keeping the old (now empty) one — fall back to the biggest sheet rather
  // than parsing 0 rows (7/20 TA format change).
  if (rows.length < 2 && wb.SheetNames.length > 1) {
    let best = rows
    for (const n of wb.SheetNames) {
      const r = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[n], { header: 1, raw: true, defval: null })
      if (r.length > best.length) best = r
    }
    return best
  }
  return rows
}

/** Compact dump of the sheet's top-left corner for parse-failure logs — makes
 *  the NEXT vendor format change diagnosable straight from Vercel logs. */
function sheetPreview(rows: any[][], nRows = 12, nCols = 8): string {
  return rows.slice(0, nRows)
    .map((r, i) => `${i}: ${JSON.stringify((r || []).slice(0, nCols)).slice(0, 220)}`)
    .join(' | ')
}

/** normalize a header cell: lowercase, collapse whitespace, strip trailing punctuation */
function normCell(v: any): string {
  return String(v ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[.:]+$/, '').trim()
}

/**
 * Tolerant header finder: for each output key, a list of acceptable header
 * spellings — 'text' must equal, '~text' must be contained. First row where
 * every key matches a distinct column wins. Vendors rename/pad headers
 * without notice (7/20: TA changed its layout and the exact match broke).
 */
function findHeaderFuzzy(
  rows: any[][],
  specs: Array<{ key: string; candidates: string[]; optional?: boolean }>,
): { row: number; cols: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = (rows[i] || []).map(normCell)
    const cols: Record<string, number> = {}
    const used = new Set<number>()
    let ok = true
    for (const spec of specs) {
      let found = -1
      for (const cand of spec.candidates) {
        const contains = cand.startsWith('~')
        const needle = contains ? cand.slice(1) : cand
        found = cells.findIndex((c, idx) =>
          !used.has(idx) && c.length > 0 && (contains ? c.includes(needle) : c === needle))
        if (found >= 0) break
      }
      if (found < 0) {
        // Optional columns (retail/pump price) may be missing or renamed
        // beyond recognition — the row still counts as the header. Callers
        // see -1 and derive the value instead.
        if (spec.optional) { cols[spec.key] = -1; continue }
        ok = false
        break
      }
      cols[spec.key] = found
      used.add(found)
    }
    if (ok) return { row: i, cols }
  }
  return null
}

/**
 * Header spellings we've seen (or expect) for the column holding OUR price —
 * the whole point of the feed. England's vendors keep renaming this one:
 * 7/20 TA reshuffled its layout, 7/24 it dropped "Disc" entirely
 * ("Carrier Disc Price" -> "Carrier Price"), starving TA for a day.
 * Matched only AFTER '~retail' has claimed the retail column, so a plain
 * '~carrier'/'~price' fallback can't steal it.
 */
/**
 * Header spellings for the pump/retail price column. 9/8 TA renamed
 * "Retail Price" -> "Fuel Price" and the whole TA feed starved for a week.
 * Retail is display-only (the crossed-out pump price), so it's OPTIONAL:
 * when no column matches we derive it from discount + savings.
 */
const RETAIL_PRICE_CANDIDATES = ['~retail', '~fuel price', '~pump', '~list price', '~street', '~cash price']

/** Retail from the sheet when present, else discount + savings, else 0. */
function retailOrDerived(retail: number, yours: number, savings: number): number {
  if (retail > 0) return retail
  if (isFinite(savings) && savings > 0) return Math.round((yours + savings) * 1000) / 1000
  return 0
}

const DISCOUNT_PRICE_CANDIDATES = [
  '~disc',
  '~carrier price',
  '~your price',
  '~cost plus',
  '~net price',
  '~carrier',
]

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
// Pilot's daily "Better Of Pricing Report", in either of its two generations:
//   through 11/9/26 — "Pricing - Pilot Flying J" email with cp<account>.xls
//     attached: Prod "DSL", sites zero-padded ("001"), retail / your price /
//     savings in cols 17 / 19 / 20.
//   from 11/10/26 — "<date> Price Quote - Pilot Flying J" email with a LINK to
//     pq-<account>-<MMDDYYYY>.xlsx: Prod "Truck Diesel", sites unpadded ("1"),
//     one column fewer (16 / 18 / 19).
// Price columns are found by header name; the old fixed positions are only a
// fallback for a sheet with no "Your Price" header. Sites are padded to three
// digits so the coord cache and kpi's price history keep joining on one key.
export function parsePilotXls(buffer: Buffer): ParsedStation[] {
  const rows = sheetRows(buffer)
  const header = findHeader(rows, ['Site', 'City', 'ST'])
  if (!header) throw new Error(`Could not find header row (Site / City / ST) in Pilot xls — sheet preview: ${sheetPreview(rows)}`)
  const labels = (rows[header.row] || []).map(normCell)
  const named = labels.includes('your price')
  const prodCol = labels.indexOf('prod') >= 0 ? labels.indexOf('prod') : 3
  const yourCol = named ? labels.indexOf('your price') : 19
  const retailCol = named ? labels.indexOf('retail price') : 17
  const savingsCol = named ? labels.findIndex(l => l.startsWith('savings')) : 20
  const stations: ParsedStation[] = []
  for (let i = header.row + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const site = r[header.cols['Site']]
    const city = r[header.cols['City']]
    const state = r[header.cols['ST']]
    const prod = r[prodCol]
    if (site == null || city == null || state == null) continue
    if (String(site).trim() === '') continue
    if (prod != null && !isTruckDiesel(prod)) continue
    const yours = num(r[yourCol])
    if (!(yours > 0)) continue
    const retail = retailCol >= 0 ? num(r[retailCol]) : NaN
    const savings = savingsCol >= 0 ? num(r[savingsCol]) : NaN
    stations.push({
      brand: 'pfj',
      site: pilotSite(site),
      city: String(city).trim(),
      state: String(state).trim().toUpperCase(),
      retailPrice: retail > 0 ? retail : 0,
      yourPrice: yours,
      savings: isFinite(savings) ? savings : 0,
    })
  }
  return stations
}

/** "DSL" (old sheet) or "Truck Diesel" (new) — never reefer/dyed fuel or DEF. */
function isTruckDiesel(prod: any): boolean {
  const p = String(prod).trim().toLowerCase()
  if (p === '' || p === 'dsl') return true
  return p.includes('diesel') && !/reefer|dyed|off.?road/.test(p)
}

/** Pilot site numbers as the rest of the system keys them: "1" -> "001". */
function pilotSite(site: any): string {
  const s = String(site).trim()
  return /^\d+$/.test(s) ? s.padStart(3, '0') : s
}

/** The Ascend account a Pilot sheet was priced for ("Account: 370934 - …"). */
export function pilotSheetAccount(buffer: Buffer): string | null {
  try {
    for (const row of sheetRows(buffer).slice(0, 12)) {
      for (const cell of row || []) {
        const m = String(cell ?? '').match(/account:\s*(\d{4,})/i)
        if (m) return m[1]
      }
    }
  } catch { /* not a readable workbook */ }
  return null
}

// ── Love's ─────────────────────────────────────────────────────────────────
// "CP Loves Forecast MM.DD.YY ... .xlsx" from the England Logistics daily
// email — sheet "LovesPrices":
//   Loves Store No. | City | State | Retail Price | Disc. Price | Total Savings
export function parseLovesXlsx(buffer: Buffer): ParsedStation[] {
  const rows = sheetRows(buffer, 'LovesPrices')
  const header =
    findHeader(rows, ['Loves Store No.', 'City', 'State', 'Retail Price', 'Disc. Price']) ??
    findHeaderFuzzy(rows, [
      // 8/24: "Loves Store No." -> "Loves Store" (no "no") and Love's starved.
      { key: 'Loves Store No.', candidates: ['~store no', '~store #', '~store', '~loves', '~site', 'no', '#', 'number'] },
      { key: 'City', candidates: ['city', '~city'] },
      { key: 'State', candidates: ['state', 'st'] },
      { key: 'Retail Price', candidates: RETAIL_PRICE_CANDIDATES, optional: true },
      { key: 'Disc. Price', candidates: DISCOUNT_PRICE_CANDIDATES },
    ])
  if (!header) throw new Error(`Could not find header row (Loves Store No. / City / State ...) in Loves xlsx — sheet preview: ${sheetPreview(rows)}`)
  const savingsCol =
    (findHeader(rows, ['Total Savings']) ?? findHeaderFuzzy(rows, [{ key: 'Total Savings', candidates: ['~saving'] }]))
      ?.cols['Total Savings'] ?? -1
  const stations: ParsedStation[] = []
  for (let i = header.row + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const site = r[header.cols['Loves Store No.']]
    const city = r[header.cols['City']]
    const state = r[header.cols['State']]
    if (site == null || city == null || state == null) continue
    const yours = num(r[header.cols['Disc. Price']])
    if (!(yours > 0)) continue
    const savings = savingsCol >= 0 && isFinite(num(r[savingsCol])) ? num(r[savingsCol]) : 0
    const retailCol = header.cols['Retail Price']
    stations.push({
      brand: 'loves',
      site: String(site).trim(),
      city: String(city).trim(),
      state: String(state).trim().toUpperCase(),
      retailPrice: retailOrDerived(retailCol >= 0 ? num(r[retailCol]) : 0, yours, savings),
      yourPrice: yours,
      savings,
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
  // Exact layout first (unchanged behavior), then a tolerant pass — TA renamed
  // its headers on 7/20 and the exact match silently starved the whole feed;
  // 9/8 it renamed "Retail Price" -> "Fuel Price" (retail is optional now).
  const header =
    findHeader(rows, ['#', 'Travel Center', 'ST', 'Retail Price', 'Carrier Disc Price']) ??
    findHeaderFuzzy(rows, [
      { key: '#', candidates: ['#', 'no', 'site #', 'site', '~location id', '~store no', '~store #', '~loc id', 'number'] },
      { key: 'Travel Center', candidates: ['~travel center', '~location name', '~site name', 'location', 'name'] },
      { key: 'ST', candidates: ['st', 'state'] },
      { key: 'Retail Price', candidates: RETAIL_PRICE_CANDIDATES, optional: true },
      { key: 'Carrier Disc Price', candidates: DISCOUNT_PRICE_CANDIDATES },
    ])
  if (!header) {
    throw new Error(
      `Could not find header row (# / Travel Center / ST ...) in TA xls — sheet preview: ${sheetPreview(rows)}`,
    )
  }
  const savingsCol =
    (findHeader(rows, ['Total Savings']) ?? findHeaderFuzzy(rows, [{ key: 'Total Savings', candidates: ['~saving'] }]))
      ?.cols['Total Savings'] ?? -1
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
    const savings = savingsCol >= 0 && isFinite(num(r[savingsCol])) ? num(r[savingsCol]) : 0
    const retailCol = header.cols['Retail Price']
    bySite.set(key, {
      brand: 'ta',
      site: key,
      name,
      city: city || name,
      state: String(state).trim().toUpperCase(),
      retailPrice: retailOrDerived(retailCol >= 0 ? num(r[retailCol]) : 0, yours, savings),
      yourPrice: yours,
      savings,
    })
  }
  return Array.from(bySite.values())
}
