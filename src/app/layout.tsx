import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Simon Express — Driver Portal',
  description: 'Document submission and fuel pricing for Simon Express drivers.',
  manifest: '/manifest.json',
  themeColor: '#111111',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SE Portal',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  viewportFit: 'cover' as const,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
