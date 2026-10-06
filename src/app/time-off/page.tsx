'use client'

// /time-off — a driver asks for days off, or a 34-hour restart. Goes straight
// onto the dispatch Google Sheet ("T/O Utah" / "34 Texas", yellow) for every
// day that is still empty; dispatch is notified. Identity = sx_driver cookie
// (middleware-gated). The page never shows what dispatch wrote on the sheet.

import { useCallback, useEffect, useState } from 'react'
import styles from '../docs/page.module.css'
import DriverBadge from '@/components/DriverBadge'

type Kind = 'time_off' | 'restart34'

type PastRequest = {
  id: string
  kind: Kind
  city: string | null
  state: string | null
  after_order_num: string | null
  start_date: string
  end_date: string
  note: string | null
  truck_number: string | null
  days_written: number
  days_occupied: string[]
  days_off_sheet: string[]
  sheet_error: string | null
  created_at: string
}

type Load = { order_num: string; origin: string | null; destination: string | null; ship_date: string | null; delivery_date: string | null; customer: string | null }

type Result = {
  ok: boolean
  error?: string
  kind?: Kind
  truck?: string | null
  days?: string[]
  written?: string[]
  occupied?: string[]
  alreadyOff?: string[]
  offSheet?: string[]
  conflict?: boolean
  sheetError?: string | null
  afterLoad?: { order_num: string; delivery_date: string } | null
}

const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fmt = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
}
const fmtRange = (a: string, b: string) => (a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`)
/** Consecutive days → "Thu Oct 22 – Thu Oct 29", gaps separated by commas. */
const fmtDays = (days: string[]) => {
  const sorted = [...days].sort()
  const groups: { s: string; e: string }[] = []
  for (const d of sorted) {
    const g = groups[groups.length - 1]
    const next = g ? new Date(Date.parse(`${g.e}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : ''
    if (g && next === d) g.e = d
    else groups.push({ s: d, e: d })
  }
  return groups.map((g) => fmtRange(g.s, g.e)).join(', ')
}

const label = { fontSize: 12, color: 'var(--mute)', fontWeight: 600 } as const

export default function TimeOffPage() {
  const [kind, setKind] = useState<Kind>('time_off')
  const [start, setStart] = useState(todayISO())
  const [end, setEnd] = useState(todayISO())
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [note, setNote] = useState('')
  const [afterLoad, setAfterLoad] = useState<string>('') // '' = pick a date
  const [loads, setLoads] = useState<Load[]>([])
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

  // Assigned loads for "take a 34 after this load" — current + next, from kpi.
  useEffect(() => {
    fetch('/api/current-load', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const out: Load[] = []
        if (j?.load?.order_num) out.push(j.load)
        if (j?.next_load?.order_num) out.push(j.next_load)
        setLoads(out)
      })
      .catch(() => setLoads([]))
  }, [])

  const switchKind = (k: Kind) => {
    setKind(k)
    setResult(null)
    if (k === 'restart34') setEnd(start)
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      const r = await fetch('/api/time-off', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          start,
          end: kind === 'restart34' ? start : end,
          note,
          city,
          state,
          load: kind === 'restart34' ? afterLoad : '',
        }),
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
    if (kind === 'restart34') return 1
    if (!start || !end || end < start) return 0
    return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1
  })()
  const usingLoad = kind === 'restart34' && afterLoad !== ''
  const canSend = !busy && (usingLoad || (days >= 1 && days <= 30))

  const today = todayISO()
  const upcoming = past.filter((p) => p.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date))
  const earlier = past.filter((p) => p.end_date < today)

  const row = (p: PastRequest) => (
    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
      <div>
        <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
          {p.kind === 'restart34' ? '34 restart · ' : ''}{fmtRange(p.start_date, p.end_date)}
        </div>
        <div style={{ color: 'var(--mute)' }}>
          {[p.city, p.state].filter(Boolean).join(', ')}{p.after_order_num ? ` · after load ${p.after_order_num}` : ''}{p.note ? ` · ${p.note}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', color: 'var(--mute)', whiteSpace: 'nowrap' }}>
        {p.sheet_error ? 'sent to dispatch' : `on board${p.truck_number ? ` · truck ${p.truck_number}` : ''}`}
      </div>
    </div>
  )

  return (
    <div className={styles.app}>
      <div style={{ height: 4, background: 'var(--red)', flexShrink: 0 }} />
      <div className={styles.topBar}>
        <a href="/" className={styles.backPill}>← Back</a>
        <div style={{ marginLeft: 'auto' }}><DriverBadge /></div>
      </div>

      <h1 className={styles.screenTitle}>{kind === 'restart34' ? 'Take a 34' : 'Request Time Off'}</h1>
      <p className={styles.screenSubtitle}>Goes straight onto the dispatch board. Dispatch is notified right away.</p>

      {/* Mode toggle */}
      <section className={styles.section}>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['time_off', 'restart34'] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => switchKind(k)}
              style={{
                flex: 1, padding: '12px 10px', borderRadius: 'var(--r-md)', fontFamily: 'var(--display)', fontSize: 14,
                fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
                border: '1px solid', borderColor: kind === k ? 'var(--red-dark)' : 'var(--line)',
                background: kind === k ? 'var(--red)' : 'var(--white)', color: kind === k ? '#fff' : 'var(--ink)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {k === 'time_off' ? 'Time off' : 'Take a 34'}
            </button>
          ))}
        </div>
      </section>

      {kind === 'restart34' && (
        <section className={styles.section}>
          <p className={styles.sectionLabel}>When</p>
          <div className={styles.card}>
            {loads.map((l) => (
              <label key={l.order_num} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: 'var(--ink)' }}>
                <input type="radio" name="when" checked={afterLoad === l.order_num} onChange={() => setAfterLoad(l.order_num)} style={{ marginTop: 3 }} />
                <span>
                  <strong>After load {l.order_num}</strong>
                  <span style={{ display: 'block', color: 'var(--mute)', fontSize: 12 }}>
                    {[l.origin, l.destination].filter(Boolean).join(' → ')}{l.delivery_date ? ` · delivers ${fmt(l.delivery_date)}` : ''}
                  </span>
                </span>
              </label>
            ))}
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, color: 'var(--ink)' }}>
              <input type="radio" name="when" checked={afterLoad === ''} onChange={() => setAfterLoad('')} />
              <span><strong>On a date</strong></span>
            </label>
            {afterLoad === '' && (
              <input className={styles.input} type="date" value={start} min={today} onChange={(e) => { setStart(e.target.value); setEnd(e.target.value) }} />
            )}
            {loads.length === 0 && <p style={{ fontSize: 12, color: 'var(--mute)' }}>No assigned load found to pick from, so choose a date.</p>}
          </div>
        </section>
      )}

      {kind === 'time_off' && (
        <section className={styles.section}>
          <p className={styles.sectionLabel}>Dates</p>
          <div className={styles.card}>
            <label style={label}>First day off</label>
            <input className={styles.input} type="date" value={start} min={today}
              onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }} />
            <label style={label}>Last day off</label>
            <input className={styles.input} type="date" value={end} min={start || today} onChange={(e) => setEnd(e.target.value)} />
            {days > 0 && (
              <p style={{ fontSize: 13, color: 'var(--mute)' }}>{days} day{days === 1 ? '' : 's'} · {fmtRange(start, end)}</p>
            )}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <p className={styles.sectionLabel}>Where will you be?</p>
        <div className={styles.card}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className={styles.input} type="text" placeholder="City" value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} autoComplete="off" style={{ flex: 2 }} />
            <input className={styles.input} type="text" placeholder="State" value={state} maxLength={20} onChange={(e) => setState(e.target.value)} autoComplete="off" style={{ flex: 1 }} />
          </div>
          <label style={label}>Reason (optional, shows on the board)</label>
          <input className={styles.input} type="text" placeholder="doctor, wedding, home time…" value={note} maxLength={80}
            onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          <p style={{ fontSize: 12, color: 'var(--mute)' }}>
            The board will read {kind === 'restart34' ? '"34' : '"T/O'}{state ? ` ${state}` : usingLoad ? ' (delivery state)' : ''}{note ? ` ${note}` : ''}".
          </p>
        </div>
      </section>

      <section className={styles.section}>
        <button className={styles.submitBtn} onClick={submit} disabled={!canSend}>
          {busy ? 'Sending…' : kind === 'restart34' ? 'Send 34 request' : 'Send request'}
        </button>
        {kind === 'time_off' && days > 30 && <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>Limit is 30 days per request.</p>}
      </section>

      {result && (
        <section className={styles.section}>
          <div className={styles.card} style={{ borderLeft: `4px solid ${result.ok ? 'var(--green)' : 'var(--red)'}` }}>
            {!result.ok ? (
              <p style={{ fontSize: 14, color: 'var(--ink)' }}>{result.error ?? 'Something went wrong.'}</p>
            ) : (
              <>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Request sent. Dispatch has it.</p>
                {result.afterLoad && (
                  <p style={{ fontSize: 13, color: 'var(--mute)' }}>
                    34 after load {result.afterLoad.order_num} (delivers {fmt(result.afterLoad.delivery_date)}).
                  </p>
                )}
                {result.truck && (result.written?.length ?? 0) > 0 && (
                  <p style={{ fontSize: 13, color: 'var(--mute)' }}>Marked on truck {result.truck}: {fmtDays(result.written!)}</p>
                )}
                {(result.alreadyOff?.length ?? 0) > 0 && (
                  <p style={{ fontSize: 13, color: 'var(--mute)' }}>Already marked off on the board: {fmtDays(result.alreadyOff!)}</p>
                )}
                {(result.occupied?.length ?? 0) > 0 && (
                  <p style={{ fontSize: 13, color: 'var(--mute)' }}>
                    Already has a plan on the board, dispatch will sort it out: {fmtDays(result.occupied!)}
                  </p>
                )}
                {(result.offSheet?.length ?? 0) > 0 && (
                  <p style={{ fontSize: 13, color: 'var(--mute)' }}>Too far out for the board yet, dispatch will add by hand: {fmtDays(result.offSheet!)}</p>
                )}
                {result.sheetError && (
                  <p style={{ fontSize: 13, color: 'var(--mute)' }}>Board not updated automatically ({result.sheetError}). Dispatch was still notified.</p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className={styles.section}>
          <p className={styles.sectionLabel}>Upcoming</p>
          <div className={styles.card}>{upcoming.map(row)}</div>
        </section>
      )}
      {earlier.length > 0 && (
        <section className={styles.section} style={{ marginBottom: 24 }}>
          <p className={styles.sectionLabel}>Earlier</p>
          <div className={styles.card}>{earlier.map(row)}</div>
        </section>
      )}
      {past.length === 0 && <div style={{ height: 24 }} />}
    </div>
  )
}
