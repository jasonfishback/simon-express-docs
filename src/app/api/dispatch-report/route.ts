// Daily dispatch report — sends a summary email to dispatch every morning.
// Triggered by Vercel Cron at 13:00 UTC (07:00 Mountain during DST).
//
// Authentication:
// - Vercel Cron requests carry an Authorization header containing INGEST_API_KEY (env var)
// - Manual triggers may pass the same secret via ?key=<value> query string for testing
//
// Report contents:
// 1. Top 10 lowest-priced states (by Pilot diesel average)
// 2. Top 10 highest-priced states (by Pilot diesel average)
// 3. List of drivers who sent fuel routes yesterday (with route summary)
// 4. List of drivers who haven't sent a route in 3+ days

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getUsageSinceDays, UsageEntry } from '@/lib/usage-log'
import { FUEL_RECIPIENTS } from '@/lib/recipients'

const resend = new Resend(process.env.RESEND_API_KEY)

interface FuelStation {
  yourPrice: number
  state: string
  city: string
}

// Authenticate the incoming request
function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.INGEST_API_KEY
  if (!cronSecret) return false
  // Vercel Cron sends an Authorization header
  const auth = req.headers.get('authorization')
  if (auth === `Bearer ${cronSecret}`) return true
  // Allow manual ?key= override for testing
  const keyParam = req.nextUrl.searchParams.get('key')
  if (keyParam === cronSecret) return true
  return false
}

// Pull current fuel data from Vercel Blob and compute state averages
async function getStatePriceRankings(): Promise<{ lowest: any[], highest: any[] }> {
  const blobUrl = process.env.FUEL_BLOB_URL
  if (!blobUrl) throw new Error('FUEL_BLOB_URL not set')
  const res = await fetch(blobUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error('Could not fetch fuel data')
  const data = await res.json()
  const stations: FuelStation[] = data.stations || []
  // Group by state, compute average yourPrice (only states with 3+ stations)
  const byState = new Map<string, number[]>()
  for (const s of stations) {
    if (!s.state || typeof s.yourPrice !== 'number' || s.yourPrice <= 0) continue
    if (!byState.has(s.state)) byState.set(s.state, [])
    byState.get(s.state)!.push(s.yourPrice)
  }
  const stateAvgs: Array<{ state: string, avg: number, count: number }> = []
  byState.forEach((prices, state) => {
    if (prices.length < 3) return // need at least 3 stations to be representative
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length
    stateAvgs.push({ state, avg, count: prices.length })
  })
  const sorted = [...stateAvgs].sort((a, b) => a.avg - b.avg)
  return {
    lowest: sorted.slice(0, 10),
    highest: [...sorted].reverse().slice(0, 10),
  }
}

// Build the HTML email body
function buildReportHtml(args: {
  lowestStates: any[]
  highestStates: any[]
  yesterdaySends: UsageEntry[]
  inactiveDrivers: Array<{ name: string, truckNumber?: string, lastSent?: string }>
  todayLabel: string
  yesterdayLabel: string
}): string {
  const { lowestStates, highestStates, yesterdaySends, inactiveDrivers, todayLabel, yesterdayLabel } = args
  const fmtPrice = (p: number) => `$${p.toFixed(3)}`
  const fmtMoney = (n: number) => `$${n.toFixed(2)}`
  const fmtDate = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    } catch { return iso }
  }

  // Group yesterday's sends by driver to summarize
  const sendsByDriver = new Map<string, UsageEntry[]>()
  for (const s of yesterdaySends) {
    const key = s.recipientName || s.recipientEmail
    if (!sendsByDriver.has(key)) sendsByDriver.set(key, [])
    sendsByDriver.get(key)!.push(s)
  }
  const driverRows = Array.from(sendsByDriver.entries()).sort(([a], [b]) => a.localeCompare(b))
  const totalSendsYesterday = yesterdaySends.length
  const totalGalsYesterday = yesterdaySends.reduce((s, e) => s + e.gallons, 0)
  const totalCostYesterday = yesterdaySends.reduce((s, e) => s + e.cost, 0)
  const totalSavYesterday = yesterdaySends.reduce((s, e) => s + e.savings, 0)

  const stateRow = (s: any, idx: number, mode: 'low' | 'high') => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:6px 8px;font-size:12px;color:#666;width:30px">${idx + 1}</td>
      <td style="padding:6px 8px;font-size:13px;font-weight:600">${s.state}</td>
      <td style="padding:6px 8px;font-size:13px;text-align:right;color:${mode === 'low' ? '#16a34a' : '#dc2626'};font-weight:700">${fmtPrice(s.avg)}</td>
      <td style="padding:6px 8px;font-size:11px;color:#999;text-align:right">${s.count} sites</td>
    </tr>`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f0f0;margin:0;padding:0">
<div style="max-width:680px;margin:0 auto;background:#fff">
  <div style="background:#111;border-bottom:4px solid #CC0000;padding:18px 20px">
    <p style="color:#fff;font-size:20px;font-weight:800;margin:0;letter-spacing:0.5px;font-family:'Barlow Condensed',sans-serif">SIMON EXPRESS</p>
    <p style="color:#aaa;font-size:11px;letter-spacing:2px;margin:4px 0 0;text-transform:uppercase;font-family:'Barlow Condensed',sans-serif">Daily Dispatch Fuel Report · ${todayLabel}</p>
  </div>

  <div style="padding:20px">
    <p style="font-size:14px;color:#333;margin:0 0 18px">Good morning Dispatch — here's the summary for ${yesterdayLabel}.</p>

    <!-- Yesterday's activity summary -->
    <div style="background:#f8f8f8;border:1px solid #e5e5e5;border-radius:8px;padding:14px 16px;margin-bottom:20px">
      <p style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;color:#888;text-transform:uppercase;margin:0 0 10px">Yesterday's Driver Activity</p>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:8px">
        <div><span style="font-size:11px;color:#999;display:block">Routes sent</span><span style="font-size:20px;font-weight:800;color:#111">${totalSendsYesterday}</span></div>
        <div><span style="font-size:11px;color:#999;display:block">Drivers using tool</span><span style="font-size:20px;font-weight:800;color:#111">${driverRows.length}</span></div>
        <div><span style="font-size:11px;color:#999;display:block">Total fuel planned</span><span style="font-size:20px;font-weight:800;color:#111">${totalGalsYesterday.toFixed(0)} gal</span></div>
        <div><span style="font-size:11px;color:#999;display:block">Estimated savings</span><span style="font-size:20px;font-weight:800;color:#16a34a">${fmtMoney(totalSavYesterday)}</span></div>
      </div>
    </div>

    <!-- State price rankings -->
    <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px">
      <tr>
        <td style="vertical-align:top;width:50%;padding-right:8px">
          <p style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:1.5px;color:#16a34a;text-transform:uppercase;margin:0 0 8px">⬇ 10 Lowest States</p>
          <table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e5e5;border-radius:6px;overflow:hidden">
            ${lowestStates.map((s, i) => stateRow(s, i, 'low')).join('')}
          </table>
        </td>
        <td style="vertical-align:top;width:50%;padding-left:8px">
          <p style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:1.5px;color:#dc2626;text-transform:uppercase;margin:0 0 8px">⬆ 10 Highest States</p>
          <table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e5e5;border-radius:6px;overflow:hidden">
            ${highestStates.map((s, i) => stateRow(s, i, 'high')).join('')}
          </table>
        </td>
      </tr>
    </table>

    <!-- Yesterday's route sends, grouped by driver -->
    <p style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:1.5px;color:#111;text-transform:uppercase;margin:0 0 8px">Routes Sent Yesterday (by Driver)</p>
    ${driverRows.length === 0 ? `
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:12px;margin-bottom:24px">
        <p style="font-size:13px;color:#92400e;margin:0">No drivers sent themselves a fuel route yesterday.</p>
      </div>
    ` : `
      <table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e5e5;border-radius:6px;overflow:hidden;margin-bottom:24px">
        ${driverRows.map(([name, sends]) => {
          const truck = sends[0].truckNumber ? ` · Truck ${sends[0].truckNumber}` : ''
          const totalMi = sends.reduce((s, e) => s + e.miles, 0)
          const totalGal = sends.reduce((s, e) => s + e.gallons, 0)
          const totalSav = sends.reduce((s, e) => s + e.savings, 0)
          const routes = sends.map(s => {
            const o = s.origin.split(',')[0]
            const d = s.destination.split(',')[0]
            return `${o} → ${d} (${s.miles} mi)`
          }).join('<br>')
          return `
            <tr style="border-bottom:1px solid #eee">
              <td style="padding:10px 12px;vertical-align:top">
                <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#111">${name}${truck}</p>
                <p style="margin:0;font-size:12px;color:#555;line-height:1.5">${routes}</p>
              </td>
              <td style="padding:10px 12px;vertical-align:top;text-align:right;white-space:nowrap">
                <p style="margin:0;font-size:11px;color:#888">${sends.length} ${sends.length === 1 ? 'route' : 'routes'} · ${totalMi.toFixed(0)} mi</p>
                <p style="margin:2px 0 0;font-size:11px;color:#888">${totalGal.toFixed(0)} gal · saved <span style="color:#16a34a;font-weight:600">${fmtMoney(totalSav)}</span></p>
              </td>
            </tr>`
        }).join('')}
      </table>
    `}

    <!-- Inactive drivers -->
    <p style="font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:1.5px;color:#92400e;text-transform:uppercase;margin:0 0 8px">⚠ Inactive Drivers (3+ Days No Route)</p>
    ${inactiveDrivers.length === 0 ? `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:12px;margin-bottom:18px">
        <p style="font-size:13px;color:#166534;margin:0">All known drivers have used the tool within the last 3 days. ✓</p>
      </div>
    ` : `
      <table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #fde68a;border-radius:6px;overflow:hidden;margin-bottom:18px;background:#fffbeb">
        ${inactiveDrivers.map(d => `
          <tr style="border-bottom:1px solid #fef3c7">
            <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#92400e">${d.name}${d.truckNumber ? ` · Truck ${d.truckNumber}` : ''}</td>
            <td style="padding:8px 12px;font-size:11px;color:#a16207;text-align:right">${d.lastSent ? `Last sent: ${fmtDate(d.lastSent)}` : 'No sends in past 30 days'}</td>
          </tr>`).join('')}
      </table>
    `}

    <p style="font-size:11px;color:#999;margin-top:20px;text-align:center;border-top:1px solid #eee;padding-top:14px">
      Generated automatically · ${todayLabel} 7:00 AM Mountain · Simon Express dispatch tools
    </p>
  </div>
</div>
</body></html>`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    // Temporary diagnostic info to debug env var setup. Safe — does not leak the secret value.
    const cronSecret = process.env.INGEST_API_KEY
    const auth = req.headers.get('authorization')
    const keyParam = req.nextUrl.searchParams.get('key')
    return NextResponse.json({
      error: 'Unauthorized',
      diagnostic: {
        cronSecretIsSet: !!cronSecret,
        cronSecretLength: cronSecret ? cronSecret.length : 0,
        receivedKeyLength: keyParam ? keyParam.length : 0,
        receivedKeyMatches: keyParam && cronSecret ? keyParam === cronSecret : false,
        receivedAuthHeader: !!auth,
        nodeEnv: process.env.NODE_ENV,
      },
    }, { status: 401 })
  }

  try {
    const fromEmail = process.env.FROM_EMAIL || 'Simon Express Dispatch <dispatch@simonexpress.com>'
    const dispatchEmail = 'dispatch@simonexpress.com'

    // Compute date labels in Mountain time
    const now = new Date()
    const todayLabel = now.toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000))
    const yesterdayLabel = yesterday.toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'long', month: 'long', day: 'numeric' })

    // 1+2. State price rankings (10 lowest, 10 highest)
    const { lowest: lowestStates, highest: highestStates } = await getStatePriceRankings()

    // 3. Yesterday's sends — get usage entries from yesterday only (in Mountain time)
    const allLast3Days = await getUsageSinceDays(3)
    // Filter to yesterday's calendar day in Mountain time
    const ydMtnDate = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/Denver' }) // YYYY-MM-DD
    const yesterdaySends = allLast3Days.filter(e => {
      try {
        const entryDate = new Date(e.timestamp).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
        return entryDate === ydMtnDate
      } catch { return false }
    })

    // 4. Inactive drivers — anyone in recipients.ts not in the last 3 days of sends
    const allEmailsLast3Days = new Set(allLast3Days.map(e => e.recipientEmail.toLowerCase()))
    // Map all sends ever (last 30 days) by driver email to find their most recent send
    const allRecent = await getUsageSinceDays(30)
    const lastSendByEmail = new Map<string, string>()
    for (const e of allRecent) {
      const k = e.recipientEmail.toLowerCase()
      const existing = lastSendByEmail.get(k)
      if (!existing || new Date(e.timestamp) > new Date(existing)) {
        lastSendByEmail.set(k, e.timestamp)
      }
    }
    // Only include drivers who are actual drivers (truckNumber present) — internal staff don't drive
    const driverRecipients = FUEL_RECIPIENTS.filter(r => !!r.truckNumber)
    const inactiveDrivers = driverRecipients
      .filter(r => !allEmailsLast3Days.has(r.email.toLowerCase()))
      .map(r => ({
        name: `${r.first} ${r.last}`,
        truckNumber: r.truckNumber != null ? String(r.truckNumber) : undefined,
        lastSent: lastSendByEmail.get(r.email.toLowerCase()),
      }))
      // Sort: most recent send last (so longest-inactive first)
      .sort((a, b) => {
        if (!a.lastSent && !b.lastSent) return a.name.localeCompare(b.name)
        if (!a.lastSent) return -1
        if (!b.lastSent) return 1
        return new Date(a.lastSent).getTime() - new Date(b.lastSent).getTime()
      })

    const html = buildReportHtml({
      lowestStates,
      highestStates,
      yesterdaySends,
      inactiveDrivers,
      todayLabel,
      yesterdayLabel,
    })

    const subject = `Daily Fuel Report — ${todayLabel}`

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [dispatchEmail],
      subject,
      html,
    })

    if (error) {
      console.error('Resend error in dispatch report:', error)
      return NextResponse.json({ error: 'Failed to send report', details: error }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      id: data?.id,
      summary: {
        lowestStateCount: lowestStates.length,
        highestStateCount: highestStates.length,
        yesterdaySends: yesterdaySends.length,
        inactiveDrivers: inactiveDrivers.length,
      },
    })
  } catch (err: any) {
    console.error('Dispatch report error:', err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}

