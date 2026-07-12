'use client'

// "Logged in as <Name> · Switch driver" strip shown on the gated pages.
// Reads the (non-httpOnly) sx_driver cookie client-side; "Switch driver"
// clears the cookie (both domain variants) and returns to the login screen.

import { useEffect, useState } from 'react'
import {
  clearDriverCookie,
  getDriverFromDocumentCookie,
  type DriverIdentity,
} from '@/lib/driver-auth'

export default function DriverBadge() {
  const [driver, setDriver] = useState<DriverIdentity | null>(null)

  useEffect(() => {
    setDriver(getDriverFromDocumentCookie())
  }, [])

  if (!driver) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      flexWrap: 'wrap',
    }}>
      <span className="sx-mono" style={{ fontSize: 11, color: 'var(--mute)', letterSpacing: '0.03em' }}>
        Logged in as <strong style={{ color: 'var(--ink)' }}>{driver.name || driver.code}</strong>
      </span>
      <span style={{ fontSize: 11, color: 'var(--mute-3)' }}>·</span>
      <button
        onClick={() => {
          clearDriverCookie()
          window.location.href = '/login'
        }}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'var(--mono)',
          fontSize: 11,
          color: 'var(--red)',
          textDecoration: 'underline',
          textUnderlineOffset: 2,
          letterSpacing: '0.03em',
        }}
      >
        Not you? Switch driver
      </button>
    </div>
  )
}
