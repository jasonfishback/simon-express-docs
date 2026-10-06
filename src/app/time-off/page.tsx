'use client'

// /time-off — a driver asks for days off. Goes straight onto the dispatch
// Google Sheet as "T/O <note>" (yellow) for every day that is still empty,
// and dispatch is notified. Identity = sx_driver cookie (middleware-gated).

import { useCallback, useEffect, useState } from 'react'
import styles from '../docs/page.module.css'
import DriverBadge from '@/components/DriverBadge'

type PastRequest = {
  id: string
  start_date: string
  end_date: string
  note: string | null
  truck_number: string | null
  days_written: number
  days_occupied: { date: string; text: string }[]
  days_off_sheet: string[]
  sheet_error: string | null
  created_at: string
}

type Result = {
  ok: boolean
  error?: string
  truck?: string | null
  days?: string[]
  written?: string[]
  occupied?: { date: string; text: string }[]
  offSheet?: string[]
  sheetError?: string | null
}

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fmt = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const fmtRange = (a: string, b: string) => (a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`)

export default function TimeOffPage() {
  const [start, setStart] = useState(todayISO())
  const [end, setEnd] = useState(todayISO())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [past, setPast] = useState<PastRequest[]>([])

  const loadPast = useCallback(async () => {
    try {
      const r = await fetch('/api/time-off', { cache: 'no-store' })
      const j = await r.json()
      if (j?.ok) setPast(j.requests ?? [])
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { loadPast() }, [loadPast])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      const r = await fetch('/api/time-off', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ start, end, note }),
      })
      const j = (await r.json()) as Result
      setResult(j)
      if (j.ok) { setNote(''); loadPast() }
    } catch {
      setResult({ ok: false, error: 'Could not reach dispatch systems. Please call dispatch.' })
    } finally {
      setBusy(false)
    }
  }

  const days = (() => {
    if (!start || !end || end < start) return 0
    return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1
  })()

  return (
    <div className={styles.app}>
      <div style={{ height: 4, background: 'var(--red)', flexShrink: 0 }} />
      <div className={styles.topBar}>
        <a href="/" className={styles.backPill}>← Back</a>
        <div style={{ marginLeft: 'auto' }}><DriverBadge /></div>
      </div>

      <h1 className={styles.screenTitle}>Request Time Off</h1>
      <p className={styles.screenSubtitle}>Goes straight onto the dispatch board. Dispatch is notified right away.</p>

      <section className={styles.section}>
        <p className={styles.sectionLabel}>Dates</p>
        <div className={styles.card}>
          <label style={{ fontSize: 12, color: 'var(--mute)', fontWeight: 600 }}>First day off</label>
          <input className={styles.input} type="date" value={start} min={todayISO()}
            onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }} />
          <label style={{ fontSize: 12, color: 'var(--mute)', fontWeight: 600 }}>Last day off</label>
          <input className={styles.input} type="date" value={end} min={start || todayISO()} onChange={(e) => setEnd(e.target.value)} />
          <label style={{ fontSize: 12, color: 'var(--mute)', fontWeight: 600 }}>Reason (optional, shows on the board)</label>
          <input className={styles.input} type="text" placeholder="doctor, wedding, home time…" value={note} maxLength={80}
            onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          {days > 0 && (
            <p style={{ fontSize: 13, color: 'var(--mute)' }}>
              {days} day{days === 1 ? '' : 's'} · {fmtRange(start, end)}
            </p>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <button className={styles.submitBtn} onClick={submit} disabled={busy || days < 1 || days > 30}>
          {busy ? 'Sending…' : 'Send request'}
        </button>
        {days > 30 && <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>Limit is 30 days per request.</p>}
      </section>

      {result && (
        <section className={styles.section}>
          <div className={styles.card} style={{ borderLeft: `4px solid ${result.ok ? 'var(--green)' : 'var(--red)'}` }}>
            {!result.ok ? (
              <p style={{ fontSize: 14, color: 'var(--ink)' }}>{result.error ?? 'Something went wrong.'}</p>
            ) : (
              <>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Request sent. Dispatch has it.</p>
                {result.truck && (result.written?.length ?? 0) > 0 && (
                  <p style={{ fontSize: 13, color: 'var(--mute)' }}>
                    Marked T/O on truck {result.truck}: {result.written!.map(fmt).join(', ')}
                  </p>
                )}
                {(result.occupied?.length ?? 0) > 0 && (
                  <p style={{ fontSize: 13, color: 'var(--mute)' }}>
                    Already planned, left for dispatch to sort out: {result.occupied!.map((o) => `${fmt(o.date)} (${o.text})`).join(', ')}
                  </p>
                )}
                {(result.offSheet?.length ?? 0) > 0 && (
                  <p style={{ fontSize: 13, color: 'var(--mute)' }}>
                    Too far out for the board yet, dispatch will add by hand: {result.offSheet!.map(fmt).join(', ')}
                  </p>
                )}
                {result.sheetError && (
                  <p style={{ fontSize: 13, color: 'var(--mute)' }}>
                    Board not updated automatically ({result.sheetError}). Dispatch was still notified.
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section className={styles.section} style={{ marginBottom: 24 }}>
          <p className={styles.sectionLabel}>Your requests</p>
          <div className={styles.card}>
            {past.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{fmtRange(p.start_date, p.end_date)}</div>
                  {p.note && <div style={{ color: 'var(--mute)' }}>{p.note}</div>}
                </div>
                <div style={{ textAlign: 'right', color: 'var(--mute)', whiteSpace: 'nowrap' }}>
                  {p.sheet_error ? 'sent to dispatch' : `on board${p.truck_number ? ` · truck ${p.truck_number}` : ''}`}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
