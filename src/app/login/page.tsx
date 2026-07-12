'use client'

// Driver Login — the only screen a driver sees before the portal. One input:
// their driver code (validated against the kpi roster via /api/login). No
// password by design — lightweight identification for an internal tool.
// Mirrors the home page's header treatment (accent bar, frosted logo card,
// Oswald kicker) and the sx-* component classes from globals.css.

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getDriverFromDocumentCookie } from '@/lib/driver-auth'

const ERROR_COPY: Record<string, string> = {
  code: "We couldn't find that driver code. Double-check it and try again.",
  retry: 'Having trouble reaching the roster right now — give it another try in a minute.',
}

function LoginForm() {
  const searchParams = useSearchParams()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>('')

  // Arrived via an /d/<code> failure? Show why.
  useEffect(() => {
    const e = searchParams.get('e')
    if (e && ERROR_COPY[e]) setError(ERROR_COPY[e])
  }, [searchParams])

  // Already logged in (e.g. bookmarked /login) → straight to the portal.
  useEffect(() => {
    if (getDriverFromDocumentCookie()) window.location.replace('/')
  }, [])

  const nextPath = (() => {
    const n = searchParams.get('next') || '/'
    return n.startsWith('/') && !n.startsWith('//') ? n : '/'
  })()

  async function submit() {
    const trimmed = code.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.ok) {
        // Full navigation so the middleware sees the fresh cookie.
        window.location.href = nextPath
        return
      }
      setError(ERROR_COPY[j.error === 'retry' ? 'retry' : 'code'])
      setSubmitting(false)
    } catch {
      setError(ERROR_COPY.retry)
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--paper)',
      fontFamily: 'var(--body)',
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      maxWidth: '100vw',
    }}>
      {/* Top accent bar — brand red, same as home */}
      <div style={{ height: 4, background: 'var(--red)', flexShrink: 0 }} />

      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: 'calc(48px + env(safe-area-inset-top)) 16px 32px',
        gap: 24,
        width: '100%',
      }}>
        {/* Logo card — shaded box so the white-bg logo blends cleanly */}
        <div style={{
          display: 'inline-block',
          background: 'linear-gradient(180deg, #FFFFFF 0%, var(--paper) 100%)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          padding: '12px 24px',
          boxShadow: 'var(--sh-sm)',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Simon Express"
            style={{ maxWidth: 240, width: '100%', display: 'block', margin: '0 auto' }}
          />
        </div>

        {/* Login card */}
        <div className="sx-card sx-fade-in" style={{ width: '100%', maxWidth: 420, padding: '26px 22px' }}>
          <p className="sx-kicker" style={{ textAlign: 'center', marginBottom: 6 }}>
            Driver Portal
          </p>
          <h1 className="sx-display" style={{ fontSize: 26, textAlign: 'center', marginBottom: 18 }}>
            Driver Login
          </h1>

          <label
            htmlFor="driver-code"
            style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--steel)',
              marginBottom: 8,
            }}
          >
            Your driver code
          </label>
          <input
            id="driver-code"
            className="sx-input sx-mono"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            maxLength={16}
            style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 18, textAlign: 'center' }}
          />

          {error && (
            <p style={{
              marginTop: 12,
              fontSize: 13,
              lineHeight: 1.5,
              color: '#991B1B',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 'var(--r-md)',
              padding: '10px 12px',
            }}>
              {error}
            </p>
          )}

          <button
            className="sx-btn"
            onClick={submit}
            disabled={!code.trim() || submitting}
            style={{ width: '100%', marginTop: 16, minHeight: 48 }}
          >
            {submitting ? 'Checking…' : 'Log In'}
          </button>

          <p style={{
            marginTop: 16,
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--mute)',
            textAlign: 'center',
          }}>
            It&apos;s the same driver code you use everywhere else.
            Don&apos;t know it? Text dispatch and we&apos;ll get you set up.
          </p>
        </div>
      </main>

      <footer style={{
        textAlign: 'center',
        padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
        borderTop: '1px solid var(--line)',
        background: 'var(--paper-warm)',
      }}>
        <p className="sx-mono" style={{ fontSize: 11, color: 'var(--mute)', letterSpacing: '0.04em' }}>
          © 2026 Simon Express LLC · Salt Lake City, Utah
        </p>
      </footer>
    </div>
  )
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
