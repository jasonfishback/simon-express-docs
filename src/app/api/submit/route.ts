import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const resend = new Resend(process.env.RESEND_API_KEY)

interface DocAttachment {
  name: string
  base64: string
  label: string
  count: number
}

export async function POST(req: NextRequest) {
  try {
    // Check Content-Length header first for fast rejection
    const contentLength = req.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Submission too large. Please reduce the number of photos and try again.' },
        { status: 413 }
      )
    }

    const text = await req.text()

    // Check actual body size
    if (text.length > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: `Submission too large (${(text.length / (1024 * 1024)).toFixed(1)} MB). Please split into two smaller batches.` },
        { status: 413 }
      )
    }

    let body: { driverName: string; loadNumber: string; notes: string; ccEmail?: string; attachments: DocAttachment[]; batchLabel?: string }
    try {
      body = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { driverName, loadNumber, notes, ccEmail, attachments, batchLabel = '' } = body

    if (!attachments || attachments.length === 0) {
      return NextResponse.json({ error: 'No attachments provided' }, { status: 400 })
    }

    const docSummary = attachments
      .map((a) => `• ${a.label}: ${a.count} page${a.count !== 1 ? 's' : ''}`)
      .join('\n')

    const subject = `Simon Express Doc Submission — ${driverName} | Load #${loadNumber}${batchLabel}`

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #111; padding: 20px; text-align: center; border-bottom: 4px solid #CC0000;">
          <h1 style="color: #fff; font-size: 24px; margin: 0;">SIMON <span style="color:#CC0000;">EXPRESS</span></h1>
          <p style="color: #aaa; font-size: 12px; margin: 4px 0 0;">Document Submission</p>
        </div>
        <div style="background: #f9f9f9; padding: 24px; border: 1px solid #ddd;">
          <table style="width:100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 8px 0; color: #666; width: 140px;">Driver</td><td style="padding: 8px 0; font-weight: bold;">${driverName}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Load #</td><td style="padding: 8px 0;">${loadNumber}</td></tr>
            ${notes ? `<tr><td style="padding: 8px 0; color: #666;">Notes</td><td style="padding: 8px 0;">${notes}</td></tr>` : ''}
            <tr><td style="padding: 8px 0; color: #666; vertical-align: top;">Submitted</td><td style="padding: 8px 0;">${new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'full', timeStyle: 'short' })}</td></tr>
          </table>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 16px 0;"/>
          <p style="font-size: 13px; color: #444; margin-bottom: 8px;"><strong>Documents attached (B&W scans):</strong></p>
          <pre style="font-size: 13px; color: #444; white-space: pre-wrap; margin: 0;">${docSummary}</pre>
        </div>
        <div style="background: #111; padding: 12px; text-align: center;">
          <p style="color: #666; font-size: 11px; margin: 0;">Simon Express · Salt Lake City, Utah</p>
        </div>
      </div>
    `

    const emailAttachments = attachments.map((a) => ({
      filename: a.name,
      content: a.base64,
    }))

    console.log('Sending email:', subject, '| attachments:', emailAttachments.length)

    const { data, error } = await resend.emails.send({
      from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
      to: [process.env.TO_EMAIL || 'billing@simonexpress.com'],
      ...(ccEmail ? { cc: [ccEmail] } : {}),
      subject,
      html: htmlBody,
      attachments: emailAttachments,
    })

    if (error) {
      console.error('Resend error:', JSON.stringify(error))
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log('Email sent! id:', data?.id)
    return NextResponse.json({ success: true, id: data?.id })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Submission error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
