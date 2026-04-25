'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()
  const [hovering, setHovering] = useState<string | null>(null)

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0a',
      fontFamily: '-apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <header style={{
        background: '#111',
        borderBottom: '4px solid #CC0000',
        padding: '18px 20px 14px',
        textAlign: 'center',
      }}>
        <img src="/logo.png" alt="Simon Express" style={{ maxWidth: 280, width: '100%', display: 'block', margin: '0 auto' }} />
        <p style={{
          fontFamily: 'Barlow Condensed, sans-serif',
          fontSize: 11,
          letterSpacing: 3,
          color: '#666',
          textTransform: 'uppercase',
          marginTop: 8,
        }}>Driver Portal</p>
      </header>

      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        gap: 20,
      }}>
        <p style={{
          fontFamily: 'Barlow Condensed, sans-serif',
          fontSize: 13,
          letterSpacing: 2,
          color: '#555',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}>Select a section</p>

        <button
          onClick={() => router.push('/docs')}
          onMouseEnter={() => setHovering('docs')}
          onMouseLeave={() => setHovering(null)}
          style={{
            width: '100%', maxWidth: 420, padding: '32px 28px',
            background: hovering === 'docs' ? '#CC0000' : '#1a1a1a',
            border: '2px solid',
            borderColor: hovering === 'docs' ? '#CC0000' : '#2a2a2a',
            borderRadius: 16, cursor: 'pointer', textAlign: 'left',
            transition: 'all 0.2s ease',
            transform: hovering === 'docs' ? 'translateY(-2px)' : 'none',
            boxShadow: hovering === 'docs' ? '0 12px 40px rgba(204,0,0,0.3)' : '0 2px 12px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{
              width: 56, height: 56,
              background: hovering === 'docs' ? 'rgba(255,255,255,0.2)' : 'rgba(204,0,0,0.15)',
              borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={hovering === 'docs' ? '#fff' : '#CC0000'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div>
              <p style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: 0.5, marginBottom: 4 }}>
                Document Submission
              </p>
              <p style={{ fontSize: 13, color: hovering === 'docs' ? 'rgba(255,255,255,0.8)' : '#666', lineHeight: 1.4 }}>
                Submit BOL, lumper receipts & paperwork to billing
              </p>
            </div>
          </div>
          <div style={{
            marginTop: 20, paddingTop: 16, borderTop: '1px solid',
            borderColor: hovering === 'docs' ? 'rgba(255,255,255,0.2)' : '#2a2a2a',
            display: 'flex', gap: 8,
          }}>
            {['BOL', 'Lumper', 'Receipt', 'Other'].map(tag => (
              <span key={tag} style={{
                fontSize: 11, fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700,
                letterSpacing: 0.5, padding: '3px 8px', borderRadius: 4,
                background: hovering === 'docs' ? 'rgba(255,255,255,0.2)' : 'rgba(204,0,0,0.1)',
                color: hovering === 'docs' ? '#fff' : '#CC0000', textTransform: 'uppercase' as const,
              }}>{tag}</span>
            ))}
          </div>
        </button>

        <button
          onClick={() => router.push('/fuel')}
          onMouseEnter={() => setHovering('fuel')}
          onMouseLeave={() => setHovering(null)}
          style={{
            width: '100%', maxWidth: 420, padding: '32px 28px',
            background: hovering === 'fuel' ? '#1a5c2a' : '#1a1a1a',
            border: '2px solid',
            borderColor: hovering === 'fuel' ? '#16a34a' : '#2a2a2a',
            borderRadius: 16, cursor: 'pointer', textAlign: 'left',
            transition: 'all 0.2s ease',
            transform: hovering === 'fuel' ? 'translateY(-2px)' : 'none',
            boxShadow: hovering === 'fuel' ? '0 12px 40px rgba(22,163,74,0.25)' : '0 2px 12px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{
              width: 56, height: 56,
              background: hovering === 'fuel' ? 'rgba(255,255,255,0.15)' : 'rgba(22,163,74,0.15)',
              borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={hovering === 'fuel' ? '#fff' : '#16a34a'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="22" x2="15" y2="22"/>
                <line x1="4" y1="9" x2="14" y2="9"/>
                <path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/>
                <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>
              </svg>
            </div>
            <div>
              <p style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: 0.5, marginBottom: 4 }}>
                Fuel - Prices and Optimization
              </p>
              <p style={{ fontSize: 13, color: hovering === 'fuel' ? 'rgba(255,255,255,0.8)' : '#666', lineHeight: 1.4 }}>
                Daily fuel prices, savings & nearest station finder
              </p>
            </div>
          </div>
          <div style={{
            marginTop: 20, paddingTop: 16, borderTop: '1px solid',
            borderColor: hovering === 'fuel' ? 'rgba(255,255,255,0.2)' : '#2a2a2a',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={hovering === 'fuel' ? '#fff' : '#16a34a'} strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <span style={{ fontSize: 12, color: hovering === 'fuel' ? 'rgba(255,255,255,0.7)' : '#555' }}>
              Updated daily · 685 locations nationwide
            </span>
          </div>
        </button>
      </main>

      <footer style={{ textAlign: 'center', padding: '20px', borderTop: '1px solid #1a1a1a' }}>
        <p style={{ fontSize: 11, color: '#333' }}>© 2026 Simon Express LLC · Salt Lake City, Utah</p>
      </footer>
    </div>
  )
}
