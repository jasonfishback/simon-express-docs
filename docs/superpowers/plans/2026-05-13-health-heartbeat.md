# Docs Health Heartbeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `docs.simonexpress.com` report when its two crons (`fuel-ingest` every 30 min, `dispatch-report` daily) last ran, so the kpi site's health dashboard can show their status.

**Architecture:** A tiny Blob-backed heartbeat store (`src/lib/heartbeat.ts`) that reads and writes a single JSON file. Each cron handler appends a single `recordHeartbeat()` call at the end of its successful path (and a failure variant in the `catch`). A new `GET /api/health` endpoint reads the heartbeat blob and returns it as JSON, gated by the same `INGEST_API_KEY` / `CRON_SECRET` already used elsewhere in this repo.

**Tech Stack:** Next.js App Router, `@vercel/blob` (already a dep), no new dependencies. No tests configured in this repo — verify with `npx tsc --noEmit` and a manual curl after deploy.

**Spec:** No formal spec file; design captured in the parent kpi spec at `kpi/docs/superpowers/specs/2026-05-13-health-dashboard-design.md`. This plan is the entire design for the docs side.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `src/lib/heartbeat.ts` | Blob-backed `recordHeartbeat()` + `readHeartbeats()` |
| `src/app/api/health/route.ts` | Auth-gated GET returning `{ heartbeats: [...] }` |

**Modified files:**

| Path | Change |
|---|---|
| `src/app/api/fuel-ingest/route.ts` | Call `recordHeartbeat('fuel_ingest', ...)` on success + on caught error |
| `src/app/api/dispatch-report/route.ts` | Call `recordHeartbeat('dispatch_report', ...)` on success + on caught error |

---

## Task 1: `src/lib/heartbeat.ts` — Blob-backed heartbeat store

**Files:**
- Create: `src/lib/heartbeat.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/heartbeat.ts
// Single Blob-backed JSON file holding the last-run record for each cron.
// Cheap (one read or one write per cron firing), survives deploys, no DB needed.

import { put, list } from '@vercel/blob'

export type HeartbeatStatus = 'ok' | 'error'

export interface Heartbeat {
  key: string                  // 'fuel_ingest' | 'dispatch_report' | ...
  lastRunAt: string            // ISO 8601
  status: HeartbeatStatus
  recordCount?: number | null  // optional: e.g. fuel-ingest stations parsed
  message?: string | null      // optional: short error text or note
}

const BLOB_KEY = 'cron-heartbeats.json'

async function loadAll(): Promise<Heartbeat[]> {
  try {
    const { blobs } = await list({ prefix: BLOB_KEY })
    const blob = blobs.find((b) => b.pathname === BLOB_KEY)
    if (!blob) return []
    const res = await fetch(blob.url, { cache: 'no-store' })
    if (!res.ok) return []
    const text = await res.text()
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed as Heartbeat[]
  } catch (err) {
    console.error('heartbeat: load failed', err)
    return []
  }
}

async function saveAll(entries: Heartbeat[]): Promise<void> {
  await put(BLOB_KEY, JSON.stringify(entries), {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
  })
}

/**
 * Record a heartbeat for the given cron key. Overwrites any previous entry
 * for that key. Swallows its own errors so a logging failure cannot break
 * the actual cron.
 */
export async function recordHeartbeat(
  key: string,
  partial: Omit<Heartbeat, 'key' | 'lastRunAt'>
): Promise<void> {
  try {
    const all = await loadAll()
    const next = all.filter((e) => e.key !== key)
    next.push({
      key,
      lastRunAt: new Date().toISOString(),
      status: partial.status,
      recordCount: partial.recordCount ?? null,
      message: partial.message ?? null,
    })
    await saveAll(next)
  } catch (err) {
    console.error(`heartbeat: failed to record ${key}`, err)
  }
}

/** Return all heartbeats. Used by /api/health. */
export async function readHeartbeats(): Promise<Heartbeat[]> {
  return loadAll()
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
npx tsc --noEmit src/lib/heartbeat.ts
```

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add src/lib/heartbeat.ts
git commit -m "feat(health): add Blob-backed heartbeat store"
```

---

## Task 2: `src/app/api/health/route.ts` — auth-gated health endpoint

**Files:**
- Create: `src/app/api/health/route.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/app/api/health/route.ts
// GET endpoint returning the heartbeat state of each cron.
// Auth: same INGEST_API_KEY/CRON_SECRET pair as the other endpoints
// (Bearer header OR ?key=). Not public.

import { NextRequest, NextResponse } from 'next/server'
import { readHeartbeats } from '@/lib/heartbeat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET || ''
  const ingestKey = process.env.INGEST_API_KEY || ''
  if (!cronSecret && !ingestKey) return false

  const auth = req.headers.get('authorization') || ''
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true
  if (ingestKey && auth === `Bearer ${ingestKey}`) return true

  const keyParam = req.nextUrl.searchParams.get('key') || ''
  if (cronSecret && keyParam === cronSecret) return true
  if (ingestKey && keyParam === ingestKey) return true

  return false
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const heartbeats = await readHeartbeats()
    return NextResponse.json(
      { heartbeats, fetchedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to read heartbeats' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Type-check**

Run:

```bash
npx tsc --noEmit src/app/api/health/route.ts
```

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/health/route.ts
git commit -m "feat(health): add auth-gated /api/health endpoint"
```

---

## Task 3: Instrument `fuel-ingest` to record a heartbeat

**Files:**
- Modify: `src/app/api/fuel-ingest/route.ts`

- [ ] **Step 1: Add the import**

At the top of `src/app/api/fuel-ingest/route.ts`, alongside the existing imports, add:

```typescript
import { recordHeartbeat } from '@/lib/heartbeat'
```

- [ ] **Step 2: Find the successful-return path**

Read the file and find the end of the main `GET`/`POST` handler — the line where the route returns success after a successful ingest. This is typically a `return NextResponse.json({ ... ok: true, stations: <N> ... })` near the bottom of the handler.

- [ ] **Step 3: Record success before the success return**

Immediately before the success `return NextResponse.json(...)`, add (substitute `<stationsCountVar>` with whatever variable holds the parsed station count in your handler — likely `stations.length` or a similar local):

```typescript
await recordHeartbeat('fuel_ingest', {
  status: 'ok',
  recordCount: <stationsCountVar>,
  message: null,
})
```

If the success path returns `{ ok: false }` or a "no email found" non-error early return, also call `recordHeartbeat` with `status: 'ok'` and `message: 'no new email'` so the heartbeat advances even on no-op runs. (We want to know the cron is alive, not just that data changed.)

- [ ] **Step 4: Record failure in the catch block**

Find the outermost `try { ... } catch (err) { ... }` around the main handler logic. Inside the `catch`, before whatever error response is returned, add:

```typescript
await recordHeartbeat('fuel_ingest', {
  status: 'error',
  recordCount: null,
  message: String((err as any)?.message || err).slice(0, 200),
})
```

If there isn't a top-level `try/catch`, wrap the body of the handler in one — but only after carefully reading the existing flow to make sure you don't change error-response shape. Match the existing error-return pattern.

- [ ] **Step 5: Type-check**

Run:

```bash
npx tsc --noEmit src/app/api/fuel-ingest/route.ts
```

Expected: clean exit. (If `<stationsCountVar>` is wrong, you'll see a TS error pointing at the bad name — fix and re-run.)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/fuel-ingest/route.ts
git commit -m "feat(health): record fuel-ingest heartbeats on success and error"
```

---

## Task 4: Instrument `dispatch-report` to record a heartbeat

**Files:**
- Modify: `src/app/api/dispatch-report/route.ts`

- [ ] **Step 1: Add the import**

At the top of `src/app/api/dispatch-report/route.ts`, alongside the existing imports, add:

```typescript
import { recordHeartbeat } from '@/lib/heartbeat'
```

- [ ] **Step 2: Record success before the success return**

Find the successful-return path of the handler (typically `return NextResponse.json({ ok: true, ... })` near the bottom). Immediately before it, add:

```typescript
await recordHeartbeat('dispatch_report', {
  status: 'ok',
  recordCount: null,
  message: null,
})
```

If the handler returns counts (e.g. "recipients emailed: 5"), pass that as `recordCount`. Otherwise `null` is fine.

- [ ] **Step 3: Record failure in the catch block**

Find the outermost `try/catch` around the handler body. Inside the `catch`, before the error response, add:

```typescript
await recordHeartbeat('dispatch_report', {
  status: 'error',
  recordCount: null,
  message: String((err as any)?.message || err).slice(0, 200),
})
```

Same caveat as Task 3, Step 4: if there's no top-level try/catch yet, only add one if it's safe to do so without changing existing error-response shapes.

- [ ] **Step 4: Type-check**

Run:

```bash
npx tsc --noEmit src/app/api/dispatch-report/route.ts
```

Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/dispatch-report/route.ts
git commit -m "feat(health): record dispatch-report heartbeats on success and error"
```

---

## Task 5: Manual end-to-end verification

**Files:**
- None

- [ ] **Step 1: Deploy to Vercel preview or production**

```bash
git push
# Vercel auto-deploys; wait for the deployment to go live
```

- [ ] **Step 2: Manually trigger each cron once**

Using the same `INGEST_API_KEY` already configured on the docs project:

```bash
curl -i "https://docs.simonexpress.com/api/fuel-ingest?key=<INGEST_API_KEY>"
curl -i "https://docs.simonexpress.com/api/dispatch-report?key=<INGEST_API_KEY>"
```

Expected: each returns 200 (or whatever existing success status they use).

- [ ] **Step 3: Verify the heartbeat blob populates**

```bash
curl -s -H "Authorization: Bearer <INGEST_API_KEY>" \
  "https://docs.simonexpress.com/api/health"
```

Expected JSON:

```json
{
  "heartbeats": [
    { "key": "fuel_ingest", "lastRunAt": "2026-05-13T...", "status": "ok", "recordCount": 1234, "message": null },
    { "key": "dispatch_report", "lastRunAt": "2026-05-13T...", "status": "ok", "recordCount": null, "message": null }
  ],
  "fetchedAt": "..."
}
```

- [ ] **Step 4: Confirm 401 without auth**

```bash
curl -i "https://docs.simonexpress.com/api/health"
```

Expected: HTTP 401.

- [ ] **Step 5: No commit**

Verification only.

---

## Self-Review Notes

- **Spec coverage**: The kpi spec's "Docs Site" section requires `last_run_at`, `record_count`, `status`, `message` per heartbeat — all four fields are produced (Task 1) and exposed (Task 2). Auth pattern matches existing routes in the repo (Task 2 uses the same `isAuthorized` shape as `fuel-ingest`).
- **Placeholders**: One acceptable placeholder: `<stationsCountVar>` in Task 3 Step 3 and `<INGEST_API_KEY>` in Task 5. These are repo-state lookups (the engineer reads the file and substitutes the real local variable name) and secret lookups (they paste the real key) — neither is an unspecified design decision.
- **Type consistency**: `Heartbeat` is defined once in `src/lib/heartbeat.ts` and consumed by `src/app/api/health/route.ts`. The kpi-side `DocsHeartbeat` type uses `key`, `lastRunAt`, `recordCount`, `status`, `message` — exact match.
- **Failure isolation**: `recordHeartbeat` swallows its own errors so a Blob outage cannot prevent a cron from completing.
