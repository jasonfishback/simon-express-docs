# Fuel Planner v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load-picker-first workflow on the driver portal fuel planner (multi-select current/next load → multi-stop optimization), a decluttered post-plan screen, fixed/enriched all-stops list, and an HOS "plan my hours & stops" panel — all thumb-friendly on mobile.

**Architecture:** All portal UI lives in the single client component `src/app/fuel/page.tsx` (docs repo, follows the repo's one-big-file pattern); the new Hours panel is a self-contained component `src/app/fuel/HoursPanel.tsx` fetching a new docs proxy `/api/hos`, which forwards to a new public roster-gated kpi endpoint `/api/driver-login/hos` (same posture as `/api/driver-login/fuel-run`). Multi-load routing reuses the existing `planRoute()` waypoint support: current+next selected ⇒ origin = current load origin, vias = [current delivery, next pickup], destination = next delivery; truck GPS start logic (`useMyLoad`/`truckPosRef`) unchanged.

**Tech Stack:** Next.js app router ×2 repos (docs = `C:\Users\Jason\github\docs`, kpi = `C:\Users\Jason\github\kpi`), Supabase (`driver_hos`, `lib/omnitracs.ts getDriverDutyByDay`), Google Maps JS. kpi has vitest; docs has NO test infra — verification there = `tsc --noEmit` + `next build` + ultracode review workflow.

## Global Constraints

- Plan optimization NEVER changes: cheapest-optimized plan is always the default; extra stops are informational only.
- Tap targets ≥ 48px tall on anything a driver touches (Jason: "good size buttons so easy to hit with your thumb").
- Retail pump price is DERIVED on the portal: `station.yourPrice + station.savings` (no retail field exists). Hide pump/save UI when `savings <= 0`.
- HOS: NEVER advise stretching hours. If clocks look defaulted (`driveLeft >= 11 && dutyLeft >= 14`) or `fetched_at` > 8h old ⇒ mark `reliable: false` and the UI says "check your ELD" instead of quoting numbers (same rule Bruno uses in `kpi/app/api/ask/route.ts` ~line 2015-2040).
- kpi endpoint posture: public, rate-limited, roster-gated, unknown codes return `{ ok: true }` with no data (copy `kpi/app/api/driver-login/fuel-run/route.ts`).
- docs `next build` locally requires env `RESEND_API_KEY` set to anything (pre-existing module-scope Resend constructor).
- Ship each repo via branch → PR → squash-merge (never straight to main); verify Vercel deploy by fetching the served `app/fuel/page-*.js` chunk with cookie `sx_driver=RUSTROCA.VGVzdA` and grepping a new string.

---

### Task 1: All-stops list — no city cutoff, pump price, rich expand

**Files:**
- Modify: `docs/src/app/fuel/page.tsx` — the `extraRouteStops.map(...)` row renderer (search `Also on your route · sorted by mile`).

**Interfaces:**
- Consumes: `extraRouteStops: {station, mile, detour}[]`, `expandedExtraIdx`, `brandMeta()`, `stationLabel()`, `appleMapsUrl()`, `googleMapsUrl()`.
- Produces: nothing new — pure JSX changes.

- [ ] **Step 1: Replace the row + expanded JSX.** Row becomes two lines (name wraps, city/state gets its own line so it never truncates); price cell gains struck pump; expanded section gains the price breakdown + amenities + address; maps buttons stay:

```tsx
{/* row header */}
<div style={{ flex: 1, minWidth: 0 }}>
  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>
    {stationLabel(x.station)}
  </p>
  <p style={{ fontSize: 12, color: 'var(--mute)', marginTop: 2 }}>
    {x.station.city}, {x.station.state}
    <span className="sx-mono"> · mile {Math.round(x.mile)}{x.detour > 2 ? ` · +${Math.round(x.detour)} mi` : ''}</span>
  </p>
</div>
<div style={{ textAlign: 'right', flexShrink: 0 }}>
  {x.station.savings > 0 && (
    <p className="sx-mono" style={{ fontSize: 11, color: 'var(--mute-2)', textDecoration: 'line-through' }}>${(x.station.yourPrice + x.station.savings).toFixed(2)}</p>
  )}
  <p className="sx-mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)' }}>${x.station.yourPrice.toFixed(2)}</p>
  {x.station.savings > 0 && (
    <p className="sx-mono" style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>save ${x.station.savings.toFixed(2)}</p>
  )}
</div>
```

Expanded body (replaces the maps-buttons-only block):

```tsx
{isOpen && (
  <div style={{ padding: '0 16px 14px', background: 'var(--paper-warm)' }}>
    {x.station.address && (
      <p style={{ fontSize: 12, color: 'var(--mute)', paddingTop: 10 }}>📍 {x.station.address}{x.station.zip ? `, ${x.station.zip}` : ''}</p>
    )}
    {x.station.interstate && (
      <p style={{ fontSize: 12, color: '#9A3412', fontWeight: 600, paddingTop: 6, fontFamily: 'var(--display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>🛣 {x.station.interstate}</p>
    )}
    {(x.station.parking || x.station.showers || x.station.catScale || x.station.dieselLanes) ? (
      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--steel)', paddingTop: 8, flexWrap: 'wrap' }}>
        {x.station.parking ? <span>🅿 {x.station.parking} parking</span> : null}
        {x.station.showers ? <span>🚿 {x.station.showers} showers</span> : null}
        {x.station.catScale ? <span>⚖ scale</span> : null}
        {x.station.dieselLanes ? <span>⛽ {x.station.dieselLanes} lanes</span> : null}
      </div>
    ) : null}
    <div style={{ display: 'flex', gap: 10, paddingTop: 12 }}>
      <a href={appleMapsUrl(x.station)} onClick={e => e.stopPropagation()} className="sx-btn-ghost" style={{ flex: 1, textDecoration: 'none', minHeight: 44 }}>🍎 Apple Maps</a>
      <a href={googleMapsUrl(x.station)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="sx-btn-ghost" style={{ flex: 1, textDecoration: 'none', minHeight: 44 }}>🗺 Google Maps</a>
    </div>
  </div>
)}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit` passes in docs repo.
- [ ] **Step 3: Commit** `fix(fuel): all-stops rows — city never cut off, struck pump price, richer expand`

### Task 2: Load-picker step (the new workflow front door)

**Files:**
- Modify: `docs/src/app/fuel/page.tsx` — route planner panel (search `Plan Your Route`), state block (~line 260 `useMyLoad`), `applyLoadRoute` (~line 823).

**Interfaces:**
- Consumes: `currentLoad`, `nextLoad` (both `CurrentLoad | null`, already fetched from `/api/current-load` with `next_load`), `applyLoadRoute(load)`, `setViaPoints`, `viaRefs`, `planRoute()`, `clearRoute()`.
- Produces: state `selLoads: { current: boolean; next: boolean }`, `manualRoute: boolean`, function `applyLoadSelection(cur: boolean, nxt: boolean): void` (sets origin/vias/destination + input refs). `useMyLoad` stays TRUE whenever any load button is selected (keeps truck-GPS start + run-logging semantics; `order_num` logged = current load's when current selected, else next load's — pass through existing `currentLoad?.order_num` expression by leaving it, acceptable v1).

- [ ] **Step 1: Add state + selection applier** next to the `useMyLoad` declaration:

```tsx
// Load-picker step: which assigned load(s) the driver is fueling for.
// Both selected = multi-stop schedule (current delivery → deadhead →
// next pickup → next delivery) in one optimized plan.
const [selLoads, setSelLoads] = useState<{ current: boolean; next: boolean }>({ current: true, next: false })
const [manualRoute, setManualRoute] = useState(false)

const applyLoadSelection = useCallback((cur: boolean, nxt: boolean) => {
  const c = cur ? currentLoad : null
  const n = nxt ? nextLoad : null
  if (!c && !n) return
  const vias: string[] = []
  let o = '', d = ''
  if (c && n) {
    o = (c.origin || '').trim()
    vias.push((c.destination || '').trim(), (n.origin || '').trim())
    d = (n.destination || '').trim()
  } else if (c) { o = (c.origin || '').trim(); d = (c.destination || '').trim() }
  else if (n) { o = (n.origin || '').trim(); d = (n.destination || '').trim() }
  if (!o || !d) return
  setOrigin(o); setDestination(d)
  if (originRef.current) originRef.current.value = o
  if (destRef.current) destRef.current.value = d
  setViaPoints(vias)
  setUseMyLoad(true)
  setManualRoute(false)
}, [currentLoad, nextLoad])
```

(`setViaPoints` re-renders the via inputs from state — they're controlled (`value={vp}`), so no ref writes needed for vias.)

- [ ] **Step 2: Replace the current-load card + "use my load" button JSX** (the `currentLoad && useMyLoad` block and the `currentLoad && !useMyLoad` button) with the picker. Big buttons, ≥56px tall, whole-row tap targets, multi-select with red selected state; manual entry behind "✏️ Different route":

```tsx
{currentLoad && !manualRoute && (
  <div>
    <p className="sx-kicker" style={{ marginBottom: 8 }}>Step 1 · Which trip are you fueling?</p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {([
        { key: 'current' as const, load: currentLoad, tag: '🚚 Current load' },
        ...(nextLoad ? [{ key: 'next' as const, load: nextLoad, tag: '📅 Next load' }] : []),
      ]).map(({ key, load, tag }) => {
        const on = selLoads[key]
        return (
          <button key={key}
            onClick={() => {
              const next = { ...selLoads, [key]: !on }
              if (!next.current && !next.next) return // never zero loads selected
              setSelLoads(next)
              applyLoadSelection(next.current, next.next)
              clearRoute()
            }}
            style={{
              textAlign: 'left', minHeight: 64, padding: '12px 14px',
              borderRadius: 'var(--r-md)', cursor: 'pointer',
              border: on ? '2px solid var(--red)' : '1px solid var(--line)',
              background: on ? '#FFF5F5' : 'var(--white)',
              boxShadow: on ? 'var(--sh-red)' : 'var(--sh-sm)',
              transition: 'all var(--t-fast) var(--ease)',
            }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="sx-kicker" style={{ color: on ? 'var(--red)' : 'var(--mute)' }}>{tag} · #{load.order_num}</span>
              <span style={{ fontSize: 18 }}>{on ? '☑' : '☐'}</span>
            </span>
            <span className="sx-display" style={{ display: 'block', fontSize: 15, marginTop: 4, color: 'var(--ink)' }}>
              {load.origin} → {load.destination}
            </span>
          </button>
        )
      })}
    </div>
    {selLoads.current && selLoads.next && nextLoad && (
      <p style={{ fontSize: 12, color: 'var(--green-deep)', marginTop: 8, fontWeight: 600 }}>
        ✓ Multi-stop plan: deliver #{currentLoad.order_num}, deadhead to pickup, deliver #{nextLoad.order_num} — one fuel plan for the whole run.
      </p>
    )}
    <button className="sx-btn-soft" style={{ marginTop: 10, minHeight: 48 }}
      onClick={() => { setManualRoute(true); setUseMyLoad(false); clearRoute() }}>
      ✏️ Run a different route
    </button>
  </div>
)}
{currentLoad && manualRoute && (
  <button className="sx-btn-soft" style={{ alignSelf: 'flex-start', minHeight: 48, borderColor: 'rgba(22,163,74,0.35)', background: 'rgba(22,163,74,0.06)', color: 'var(--green-deep)' }}
    onClick={() => { setManualRoute(false); applyLoadSelection(selLoads.current, selLoads.next) }}>
    🚚 Back to my loads
  </button>
)}
```

Manual-entry wrapper condition changes from `display: currentLoad && useMyLoad ? 'none' : 'flex'` to `display: currentLoad && !manualRoute ? 'none' : 'flex'`.

- [ ] **Step 3: Multi-load semantics check.** With both selected the vias are real stopovers, so the existing "+X mi added by extra stops" pill would mislabel the deadhead. Gate that pill with `&& !(selLoads.current && selLoads.next)`.
- [ ] **Step 4: Verify** tsc + build; manually trace: initial load fetch effect calls `applyLoadRoute(load)` — replace that call with `applyLoadSelection(true, false)`? NO — `nextLoad` isn't set yet inside that closure; keep `applyLoadRoute(load)` (it produces the identical current-only result).
- [ ] **Step 5: Commit** `feat(fuel): load-picker step — multi-select current/next load, thumb-size buttons`

### Task 3: Declutter the post-plan screen

**Files:**
- Modify: `docs/src/app/fuel/page.tsx` — route planner panel wrapper.

**Interfaces:**
- Produces: state `routePanelOpen: boolean` (default `true`). Auto-collapses when a plan lands; "Edit" reopens.

- [ ] **Step 1: Add state + auto-collapse effect:**

```tsx
const [routePanelOpen, setRoutePanelOpen] = useState(true)
useEffect(() => {
  if (optimizedPlan && optimizedPlan.length > 0) setRoutePanelOpen(false)
}, [optimizedPlan])
```

- [ ] **Step 2: Wrap the planner inputs** (load picker + manual inputs + slider + Find button) in `{routePanelOpen ? (...) : (compact bar)}`. Compact bar (whole thing ≥52px, tappable):

```tsx
<button onClick={() => setRoutePanelOpen(true)} style={{ width: '100%', minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '10px 14px', cursor: 'pointer', boxShadow: 'var(--sh-sm)' }}>
  <span style={{ textAlign: 'left', minWidth: 0 }}>
    <span className="sx-kicker" style={{ display: 'block' }}>Route</span>
    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {origin} → {viaPoints.filter(v => v.trim()).map(v => `${v} → `).join('')}{destination}
    </span>
  </span>
  <span className="sx-pill" style={{ flexShrink: 0 }}>✏️ Edit</span>
</button>
```

Everything below the inputs (routeError/routeInfo/plan/summary) stays outside the collapse so results remain visible. The `Route Estimate (at 6 mpg)` amber box renders only while `routePanelOpen` (it's pre-plan info; hide it once a real plan exists: wrap with `{(!optimizedPlan || optimizedPlan.length === 0 || routePanelOpen) && (...)}`).
- [ ] **Step 3: Verify** tsc + build. **Commit** `feat(fuel): collapse planner to compact route bar once a plan is built`

### Task 4: kpi public HOS endpoint

**Files:**
- Create: `kpi/app/api/driver-login/hos/route.ts`
- Test: `kpi/lib/driver-site/__tests__/hos-endpoint.test.ts` (shape/reliability unit test on the pure helper)
- Create: `kpi/lib/driver-site/hos.ts` (pure helper so it's testable)

**Interfaces:**
- Consumes: `createServiceClient`, `normalizeDriverCode`, `allowHit`/`clientIp`, `lookupRosterDriver`, `getDriverDutyByDay` from `@/lib/omnitracs`, table `driver_hos` (cols: `driver_id, activity, day_drive_secs, day_duty_secs, rest_break_secs, week_duty_secs, recap_today_secs, recap_tomorrow_secs, fetched_at`).
- Produces: `GET /api/driver-login/hos?code=XXXX` → `{ ok: true, hos: HosSummary | null }` where:

```ts
export interface HosSummary {
  reliable: boolean;          // false when defaulted maxes or stale feed
  fetchedAt: string | null;
  driveLeftHrs: number | null;   // day_drive_secs/3600, 1dp
  dutyLeftHrs: number | null;    // day_duty_secs/3600
  cycleLeftHrs: number | null;   // week_duty_secs/3600
  recapTonightHrs: number | null;   // recap_today_secs/3600 — hours back tonight
  recapTomorrowHrs: number | null;  // recap_tomorrow_secs/3600
  nights: Array<{ date: string; backHrs: number }>; // next nights' recap from duty-by-day window
}
```

- [ ] **Step 1: Write failing test** `hos-endpoint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { summarizeHos } from '@/lib/driver-site/hos';

const row = (over: Record<string, unknown> = {}) => ({
  day_drive_secs: 5 * 3600, day_duty_secs: 8 * 3600, week_duty_secs: 30 * 3600,
  recap_today_secs: 6 * 3600, recap_tomorrow_secs: 7 * 3600,
  fetched_at: new Date().toISOString(), ...over,
});

describe('summarizeHos', () => {
  it('converts secs to 1dp hours', () => {
    const s = summarizeHos(row(), []);
    expect(s.driveLeftHrs).toBe(5); expect(s.cycleLeftHrs).toBe(30); expect(s.reliable).toBe(true);
  });
  it('flags defaulted maxes unreliable', () => {
    const s = summarizeHos(row({ day_drive_secs: 11 * 3600, day_duty_secs: 14 * 3600 }), []);
    expect(s.reliable).toBe(false);
  });
  it('flags stale feed unreliable', () => {
    const s = summarizeHos(row({ fetched_at: new Date(Date.now() - 9 * 3600e3).toISOString() }), []);
    expect(s.reliable).toBe(false);
  });
  it('null row → null clocks, unreliable', () => {
    const s = summarizeHos(null, []);
    expect(s.driveLeftHrs).toBeNull(); expect(s.reliable).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/driver-site/__tests__/hos-endpoint.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `kpi/lib/driver-site/hos.ts`:

```ts
// Pure HOS summarizer for the public driver-portal endpoint. Mirrors the
// reliability rule Bruno uses (app/api/ask/route.ts): defaulted maxes
// (drive==11 && duty==14) or a stale feed (>8h) means "check your ELD".
export interface HosNight { date: string; backHrs: number }
export interface HosSummary {
  reliable: boolean; fetchedAt: string | null;
  driveLeftHrs: number | null; dutyLeftHrs: number | null; cycleLeftHrs: number | null;
  recapTonightHrs: number | null; recapTomorrowHrs: number | null;
  nights: HosNight[];
}
const toHrs = (secs: unknown): number | null => {
  const n = Number(secs);
  return Number.isFinite(n) ? Math.round((n / 3600) * 10) / 10 : null;
};
export function summarizeHos(row: Record<string, unknown> | null, nights: HosNight[]): HosSummary {
  if (!row) return { reliable: false, fetchedAt: null, driveLeftHrs: null, dutyLeftHrs: null, cycleLeftHrs: null, recapTonightHrs: null, recapTomorrowHrs: null, nights: [] };
  const driveLeftHrs = toHrs(row.day_drive_secs);
  const dutyLeftHrs = toHrs(row.day_duty_secs);
  const fetchedAt = row.fetched_at ? String(row.fetched_at) : null;
  const stale = !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > 8 * 3600e3;
  const defaulted = driveLeftHrs != null && dutyLeftHrs != null && driveLeftHrs >= 11 && dutyLeftHrs >= 14;
  return {
    reliable: !stale && !defaulted,
    fetchedAt,
    driveLeftHrs, dutyLeftHrs,
    cycleLeftHrs: toHrs(row.week_duty_secs) != null ? Math.round((70 - (Number(row.week_duty_secs) / 3600)) * 10) / 10 : null,
    recapTonightHrs: toHrs(row.recap_today_secs),
    recapTomorrowHrs: toHrs(row.recap_tomorrow_secs),
    nights,
  };
}
```

NOTE for implementer: check `app/api/data/driver-recap/route.ts` first — if `week_duty_secs` there is already "used" vs "remaining", mirror ITS math for `cycleLeftHrs` and nights exactly; the recap-night derivation should be lifted from that file (duty-by-day window aging out), not invented.

- [ ] **Step 4: Route** `kpi/app/api/driver-login/hos/route.ts` — clone the fuel-run posture (rate limit 60/min, roster gate, never throw), `GET` with `?code=`, reads `driver_hos` by `driver_id = driver.code`, calls `getDriverDutyByDay(driver.code, 8)` to build `nights` (same aging-out mapping as driver-recap), returns `{ ok: true, hos: summarizeHos(row, nights) }`.
- [ ] **Step 5: Run tests + `next build` in kpi. Commit + PR + squash-merge.**

### Task 5: docs `/api/hos` proxy + HoursPanel + workflow button

**Files:**
- Create: `docs/src/app/api/hos/route.ts` (clone the shape of `docs/src/app/api/fuel-run/route.ts` — cookie identity via `sx_driver`, forward to kpi, always 200)
- Create: `docs/src/app/fuel/HoursPanel.tsx`
- Modify: `docs/src/app/fuel/page.tsx` — button at the bottom of the plan + panel mount + night-arrival tags.

**Interfaces:**
- Consumes: kpi `GET /api/driver-login/hos?code=` (Task 4 `HosSummary`), `getDriverFromDocumentCookie()`.
- Produces: `<HoursPanel open onClose avoidNight onAvoidNight />`; page state `showHours: boolean`, `avoidNight: boolean` (persist `localStorage 'sx_avoid_night'`). When `avoidNight`, each plan stop whose rough ETA lands 21:00–05:00 local gets a `🌙 lands ~{h}pm` amber tag (ETA = now + (stop.milesFromOrigin − truck start mile)/50mph; label prefixed "rough").

- [ ] **Step 1: proxy route** (GET, no body): read cookie → `code`; missing → `{ ok: true, hos: null }`; fetch `${KPI_BASE}/api/driver-login/hos?code=` with 5s timeout; return json or `{ ok: true, hos: null }`. Use the same KPI base constant/env the fuel-run proxy uses (check that file — do not hardcode a new URL).
- [ ] **Step 2: HoursPanel** — bottom-sheet style card, big type, honest empty state:

```tsx
'use client'
import { useEffect, useState } from 'react'

interface HosNight { date: string; backHrs: number }
interface HosSummary {
  reliable: boolean; fetchedAt: string | null
  driveLeftHrs: number | null; dutyLeftHrs: number | null; cycleLeftHrs: number | null
  recapTonightHrs: number | null; recapTomorrowHrs: number | null
  nights: HosNight[]
}

export default function HoursPanel({ open, onClose, avoidNight, onAvoidNight }: {
  open: boolean; onClose: () => void; avoidNight: boolean; onAvoidNight: (v: boolean) => void
}) {
  const [hos, setHos] = useState<HosSummary | null | 'loading'>('loading')
  useEffect(() => {
    if (!open) return
    setHos('loading')
    fetch('/api/hos', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => setHos(j?.hos ?? null))
      .catch(() => setHos(null))
  }, [open])
  if (!open) return null
  const clock = (label: string, v: number | null, color: string) => (
    <div style={{ flex: 1, minWidth: 90, textAlign: 'center', padding: '14px 8px', background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
      <p className="sx-display sx-mono" style={{ fontSize: 28, color }}>{v == null ? '—' : v.toFixed(1)}</p>
      <p className="sx-kicker" style={{ marginTop: 4 }}>{label}</p>
    </div>
  )
  return (
    <div className="sx-card sx-fade-in" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p className="sx-kicker">🕐 My Hours &amp; Stops</p>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--mute-2)', cursor: 'pointer', padding: 4 }}>×</button>
      </div>
      {hos === 'loading' ? (
        <p style={{ fontSize: 13, color: 'var(--mute)' }}>Checking your clocks…</p>
      ) : !hos ? (
        <p style={{ fontSize: 13, color: 'var(--mute)' }}>No hours data for your truck right now — check your ELD in the cab.</p>
      ) : (
        <>
          {!hos.reliable && (
            <p style={{ fontSize: 12, color: '#92400E', background: 'var(--amber-bg)', border: '1px solid var(--amber-line)', borderRadius: 'var(--r-md)', padding: '8px 12px', marginBottom: 10 }}>
              ⚠️ Clock feed looks stale/defaulted — trust the ELD in your cab over these numbers.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {clock('Drive left', hos.driveLeftHrs, 'var(--red)')}
            {clock('Shift left', hos.dutyLeftHrs, 'var(--ink)')}
            {clock('Cycle left', hos.cycleLeftHrs, 'var(--green)')}
          </div>
          {(hos.recapTonightHrs != null || hos.nights.length > 0) && (
            <div style={{ marginTop: 12 }}>
              <p className="sx-kicker" style={{ marginBottom: 6 }}>Hours back each night</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {hos.recapTonightHrs != null && (
                  <span className="sx-pill sx-pill-green">Tonight +{hos.recapTonightHrs.toFixed(1)}h</span>
                )}
                {hos.nights.slice(0, 6).map(n => (
                  <span key={n.date} className="sx-pill">{n.date.slice(5)} +{n.backHrs.toFixed(1)}h</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <button
        onClick={() => onAvoidNight(!avoidNight)}
        style={{ width: '100%', minHeight: 52, marginTop: 14, borderRadius: 'var(--r-pill)', cursor: 'pointer', fontFamily: 'var(--display)', fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
          border: avoidNight ? '2px solid var(--red)' : '1px solid var(--line)',
          background: avoidNight ? '#FFF5F5' : 'var(--white)', color: avoidNight ? 'var(--red)' : 'var(--ink)' }}>
        🌙 Avoid night driving {avoidNight ? '· ON — night arrivals flagged on your plan' : ''}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: page wiring** — under the Route Summary box add a ≥52px button `🕐 Help me plan my hours & stops` toggling `showHours`; mount `<HoursPanel …/>` right below; persist `avoidNight` to localStorage; in the plan-stop card, when `avoidNight`, compute rough arrival and render the amber `🌙 lands ~9 pm — rough` pill next to the mile line.
- [ ] **Step 4: Verify tsc + build. Commit + PR + squash-merge.**

### Task 6: Ultracode verification + deploy loop

- [ ] **Step 1:** Run a Workflow: 3 parallel reviewers over the diff (correctness/regression, mobile-UX/simplicity vs the Mudflap reference, data-integrity of price/HOS math) each returning findings; adversarially verify each finding (2-of-3 refuters kill it); fix confirmed findings.
- [ ] **Step 2:** `tsc` + `next build` both repos; PRs squash-merged.
- [ ] **Step 3:** Verify served bundles: docs chunk contains `Which trip are you fueling` and `My Hours`; kpi deploy READY.
- [ ] **Step 4:** /loop (ScheduleWakeup): re-check deploys, re-run reviewer sweep on anything fixed, stop when zero confirmed findings and both bundles verified.

## Self-Review (done)
- Spec coverage: list fixes (T1), pump price on extras (T1), simplify (T3), load-picker multi-select + different-route button (T2), thumb-size buttons (T2/T5 constraints), HOS button + hours screen + nightly recaps + avoid-night (T4/T5), "until perfect" (T6). Wrong-trip prevention = T2 by construction.
- Placeholders: none — all steps carry code or exact commands; two explicit "check that file first" notes are deliberate implementer guards, with the fallback behavior stated.
- Type consistency: `HosSummary`/`HosNight` identical in T4 and T5; `applyLoadSelection(cur, nxt)` signature consistent.
