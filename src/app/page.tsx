'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()
  const [pressed, setPressed] = useState<string | null>(null)

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
      {/* Top accent bar — brand red, like the main site */}
      <div style={{
        height: 4,
        background: 'var(--red)',
        flexShrink: 0,
      }} />

      {/* Header — light, frosted, sticky look */}
      <header style={{
        background: 'rgba(255,255,255,0.78)',
        borderBottom: '1px solid rgba(11,11,12,0.06)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        paddingTop: 'calc(20px + env(safe-area-inset-top))',
        paddingBottom: 18,
        paddingLeft: 16,
        paddingRight: 16,
        textAlign: 'center',
        boxShadow: 'var(--sh-sm)',
      }}>
        {/* Logo card — shaded box so the white-bg logo blends cleanly */}
        <div style={{
          display: 'inline-block',
          background: 'linear-gradient(180deg, #FFFFFF 0%, var(--paper) 100%)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          padding: '14px 24px',
          boxShadow: 'var(--sh-sm)',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Simon Express"
            style={{ maxWidth: 240, width: '100%', display: 'block', margin: '0 auto' }}
          />
        </div>
        <p style={{
          fontFamily: 'var(--display)',
          fontSize: 11,
          letterSpacing: '0.20em',
          color: 'var(--mute)',
          textTransform: 'uppercase',
          marginTop: 12,
          fontWeight: 600,
        }}>
          Driver Portal
        </p>
      </header>

      {/* Main — full-width frosted glass cards */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: '32px 16px',
        gap: 16,
        width: '100%',
      }}>
        <p
          className="sx-kicker"
          style={{
            color: 'var(--mute)',
            marginBottom: 4,
            textAlign: 'center',
          }}
        >
          Select a section
        </p>

        {/* Document Submission card — frosted glass, red accent */}
        <button
          onClick={() => router.push('/docs')}
          onTouchStart={() => setPressed('docs')}
          onTouchEnd={() => setPressed(null)}
          onTouchCancel={() => setPressed(null)}
          onMouseDown={() => setPressed('docs')}
          onMouseUp={() => setPressed(null)}
          onMouseLeave={() => setPressed(null)}
          style={{
            width: '100%',
            padding: '28px 24px',
            background: pressed === 'docs'
              ? 'linear-gradient(180deg, #E8252C 0%, var(--red) 60%, #C61119 100%)'
              : 'rgba(255,255,255,0.78)',
            backdropFilter: pressed === 'docs' ? undefined : 'saturate(180%) blur(20px)',
            WebkitBackdropFilter: pressed === 'docs' ? undefined : 'saturate(180%) blur(20px)',
            border: '1px solid',
            borderColor: pressed === 'docs' ? 'var(--red-dark)' : 'rgba(11,11,12,0.06)',
            borderRadius: 'var(--r-xl)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all var(--t-fast) var(--ease)',
            transform: pressed === 'docs' ? 'scale(0.98)' : 'scale(1)',
            boxShadow: pressed === 'docs'
              ? 'var(--sh-red), var(--sh-inset)'
              : 'var(--sh-md)',
            color: pressed === 'docs' ? '#fff' : 'var(--ink)',
            fontFamily: 'var(--body)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{
              width: 60, height: 60,
              background: pressed === 'docs' ? 'rgba(255,255,255,0.20)' : 'rgba(215,25,32,0.10)',
              border: '1px solid',
              borderColor: pressed === 'docs' ? 'rgba(255,255,255,0.30)' : 'rgba(215,25,32,0.18)',
              borderRadius: 'var(--r-lg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'all var(--t-fast) var(--ease)',
            }}>
              <svg
                width="30" height="30" viewBox="0 0 24 24" fill="none"
                stroke={pressed === 'docs' ? '#fff' : 'var(--red)'}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                className="sx-display"
                style={{
                  fontSize: 22,
                  color: pressed === 'docs' ? '#fff' : 'var(--ink)',
                  marginBottom: 4,
                }}
              >
                Document Submission
              </p>
              <p style={{
                fontSize: 13,
                color: pressed === 'docs' ? 'rgba(255,255,255,0.85)' : 'var(--mute)',
                lineHeight: 1.4,
              }}>
                Submit BOL, lumper receipts &amp; paperwork to billing
              </p>
            </div>
          </div>
          <div style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px solid',
            borderColor: pressed === 'docs' ? 'rgba(255,255,255,0.20)' : 'var(--line)',
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
          }}>
            {['BOL', 'Lumper', 'Receipt', 'Other'].map(tag => (
              <span key={tag} style={{
                fontSize: 10,
                fontFamily: 'var(--display)',
                fontWeight: 600,
                letterSpacing: '0.10em',
                padding: '4px 10px',
                borderRadius: 'var(--r-pill)',
                background: pressed === 'docs' ? 'rgba(255,255,255,0.20)' : 'rgba(215,25,32,0.08)',
                color: pressed === 'docs' ? '#fff' : 'var(--red)',
                textTransform: 'uppercase',
                border: '1px solid',
                borderColor: pressed === 'docs' ? 'rgba(255,255,255,0.30)' : 'rgba(215,25,32,0.20)',
              }}>{tag}</span>
            ))}
          </div>
        </button>

        {/* Fuel card — frosted glass, green accent */}
        <button
          onClick={() => router.push('/fuel')}
          onTouchStart={() => setPressed('fuel')}
          onTouchEnd={() => setPressed(null)}
          onTouchCancel={() => setPressed(null)}
          onMouseDown={() => setPressed('fuel')}
          onMouseUp={() => setPressed(null)}
          onMouseLeave={() => setPressed(null)}
          style={{
            width: '100%',
            padding: '28px 24px',
            background: pressed === 'fuel'
              ? 'linear-gradient(180deg, #22C55E 0%, var(--green) 60%, #15803D 100%)'
              : 'rgba(255,255,255,0.78)',
            backdropFilter: pressed === 'fuel' ? undefined : 'saturate(180%) blur(20px)',
            WebkitBackdropFilter: pressed === 'fuel' ? undefined : 'saturate(180%) blur(20px)',
            border: '1px solid',
            borderColor: pressed === 'fuel' ? '#15803D' : 'rgba(11,11,12,0.06)',
            borderRadius: 'var(--r-xl)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all var(--t-fast) var(--ease)',
            transform: pressed === 'fuel' ? 'scale(0.98)' : 'scale(1)',
            boxShadow: pressed === 'fuel'
              ? '0 4px 12px rgba(22,163,74,0.32), 0 10px 28px rgba(22,163,74,0.28), var(--sh-inset)'
              : 'var(--sh-md)',
            color: pressed === 'fuel' ? '#fff' : 'var(--ink)',
            fontFamily: 'var(--body)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{
              width: 60, height: 60,
              background: pressed === 'fuel' ? 'rgba(255,255,255,0.20)' : 'rgba(22,163,74,0.10)',
              border: '1px solid',
              borderColor: pressed === 'fuel' ? 'rgba(255,255,255,0.30)' : 'rgba(22,163,74,0.20)',
              borderRadius: 'var(--r-lg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'all var(--t-fast) var(--ease)',
            }}>
              <svg
                width="30" height="30" viewBox="0 0 24 24" fill="none"
                stroke={pressed === 'fuel' ? '#fff' : 'var(--green)'}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <line x1="3" y1="22" x2="15" y2="22"/>
                <line x1="4" y1="9" x2="14" y2="9"/>
                <path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/>
                <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                className="sx-display"
                style={{
                  fontSize: 22,
                  color: pressed === 'fuel' ? '#fff' : 'var(--ink)',
                  marginBottom: 4,
                }}
              >
                Fuel — Prices &amp; Optimization
              </p>
              <p style={{
                fontSize: 13,
                color: pressed === 'fuel' ? 'rgba(255,255,255,0.85)' : 'var(--mute)',
                lineHeight: 1.4,
              }}>
                Daily fuel prices, savings &amp; nearest station finder
              </p>
            </div>
          </div>
          <div style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px solid',
            borderColor: pressed === 'fuel' ? 'rgba(255,255,255,0.20)' : 'var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke={pressed === 'fuel' ? '#fff' : 'var(--green)'}
              strokeWidth="2" strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <span
              className="sx-mono"
              style={{
                fontSize: 12,
                color: pressed === 'fuel' ? 'rgba(255,255,255,0.85)' : 'var(--mute)',
                letterSpacing: '0.02em',
              }}
            >
              Updated daily · 685 locations nationwide
            </span>
          </div>
        </button>
      </main>

      {/* Footer — respects iOS home indicator */}
      <footer style={{
        textAlign: 'center',
        padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
        borderTop: '1px solid var(--line)',
        background: 'var(--paper-warm)',
      }}>
        <p
          className="sx-mono"
          style={{
            fontSize: 11,
            color: 'var(--mute)',
            letterSpacing: '0.04em',
          }}
        >
          © 2026 Simon Express LLC · Salt Lake City, Utah
        </p>
      </footer>
    </div>
  )
}
