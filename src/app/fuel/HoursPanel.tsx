'use client'

// "My Hours & Stops" panel for the fuel page — big readable HOS clocks,
// hours coming back each night, and the "avoid night driving" preference.
// Data comes from /api/hos (cookie identity → kpi driver_hos). When the
// Omnitracs feed looks defaulted or stale the panel says so and points the
// driver at the ELD in the cab instead of quoting numbers as gospel.

import { useEffect, useState } from 'react'

interface HosNight { date: string; label?: string; backHrs: number; cumulativeHrs?: number | null }
export interface HosSummary {
  reliable: boolean
  fetchedAt: string | null
  driveLeftHrs: number | null
  dutyLeftHrs: number | null
  cycleLeftHrs: number | null
  recapTonightHrs: number | null
  recapTomorrowHrs: number | null
  nights: HosNight[]
}

export default function HoursPanel({ open, onClose, avoidNight, onAvoidNight }: {
  open: boolean
  onClose: () => void
  avoidNight: boolean
  onAvoidNight: (v: boolean) => void
}) {
  const [hos, setHos] = useState<HosSummary | null | 'loading'>('loading')

  useEffect(() => {
    if (!open) return
    setHos('loading')
    fetch('/api/hos', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => setHos(j?.hos ?? null))
      .catch(() => setHos(null))
  }, [open])

  if (!open) return null

  const clock = (label: string, v: number | null, color: string) => (
    <div key={label} style={{ flex: 1, minWidth: 90, textAlign: 'center', padding: '14px 8px', background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
      <p className="sx-display sx-mono" style={{ fontSize: 28, color }}>{v == null ? '—' : v.toFixed(1)}</p>
      <p className="sx-kicker" style={{ marginTop: 4 }}>{label}</p>
    </div>
  )

  return (
    <div className="sx-card sx-fade-in" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p className="sx-kicker">🕐 My Hours &amp; Stops</p>
        <button onClick={onClose} aria-label="Close hours panel" style={{ background: 'none', border: 'none', fontSize: 24, color: 'var(--mute-2)', cursor: 'pointer', lineHeight: 1, minWidth: 48, minHeight: 48 }}>×</button>
      </div>

      {hos === 'loading' ? (
        <p style={{ fontSize: 13, color: 'var(--mute)' }}>Checking your clocks…</p>
      ) : !hos ? (
        <p style={{ fontSize: 13, color: 'var(--mute)' }}>
          No hours data for your truck right now — check your ELD in the cab.
        </p>
      ) : (
        <>
          {!hos.reliable && (
            <p style={{ fontSize: 12, color: '#92400E', background: 'var(--amber-bg)', border: '1px solid var(--amber-line)', borderRadius: 'var(--r-md)', padding: '8px 12px', marginBottom: 10 }}>
              ⚠️ Clock feed looks stale or defaulted — trust the ELD in your cab over these numbers.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {clock('Drive left', hos.driveLeftHrs, 'var(--red)')}
            {clock('Shift left', hos.dutyLeftHrs, 'var(--ink)')}
            {clock('Cycle left', hos.cycleLeftHrs, 'var(--green)')}
          </div>
          {hos.nights.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <p className="sx-kicker" style={{ marginBottom: 6 }}>Hours back each night</p>
              <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                {hos.nights.slice(0, 7).map((n, i) => (
                  <div
                    key={n.date}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 10, padding: '10px 12px', minHeight: 44,
                      borderBottom: i < Math.min(7, hos.nights.length) - 1 ? '1px solid var(--line)' : 'none',
                      background: i === 0 ? 'rgba(22,163,74,0.06)' : 'var(--white)',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: i === 0 ? 700 : 500, color: 'var(--ink)' }}>
                      {n.label || n.date}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
                      <span className="sx-mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>
                        +{n.backHrs.toFixed(1)}h
                      </span>
                      {n.cumulativeHrs != null && (
                        <span className="sx-mono" style={{ fontSize: 12, color: 'var(--mute)' }}>
                          → {n.cumulativeHrs.toFixed(1)} avail
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--mute-2)', marginTop: 6, lineHeight: 1.5 }}>
                Hours come back on the 70 as each day ages out of your 8-day window. Tomorrow night is from
                the ELD; later nights are estimates from your logged duty.
              </p>
            </div>
          )}
        </>
      )}

      <button
        onClick={() => onAvoidNight(!avoidNight)}
        style={{
          width: '100%', minHeight: 52, marginTop: 14, borderRadius: 'var(--r-pill)', cursor: 'pointer',
          fontFamily: 'var(--display)', fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
          border: avoidNight ? '2px solid var(--red)' : '1px solid var(--line)',
          background: avoidNight ? '#FFF5F5' : 'var(--white)',
          color: avoidNight ? 'var(--red)' : 'var(--ink)',
          transition: 'all var(--t-fast) var(--ease)',
        }}
      >
        🌙 {avoidNight ? 'Flagging night arrivals · ON' : 'Flag stops I’d reach at night'}
      </button>
      <p style={{ fontSize: 11, color: 'var(--mute-2)', marginTop: 6, textAlign: 'center', lineHeight: 1.5 }}>
        Marks any stop you&apos;d roll into between 9pm and 5am. It doesn&apos;t change the plan — the cheapest stops stay the plan.
      </p>
    </div>
  )
}
