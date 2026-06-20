// src/app/api/documents/ingest/route.ts
//
// Programmatic POD/BOL ingest. kpi POSTs a photo + (optional) load number +
// driver name; we make a black & white PDF and email it to billing — same
// destination/format as the web form. Key-authed via DOCS_API_KEY.

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { imageToPdfBase64 } from '@/lib/docs-process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let b: any; try { b = await req.json(); } catch { b = {}; }
  if (!process.env.DOCS_API_KEY || b.apiKey !== process.env.DOCS_API_KEY) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const driverName = String(b.driverName || 'Unknown driver').trim();
  const loadNumber = b.loadNumber ? String(b.loadNumber).trim() : null;
  const imageBase64 = String(b.imageBase64 || '');
  if (!imageBase64) return NextResponse.json({ ok: false, error: 'imageBase64 required' }, { status: 422 });

  let pdfBase64: string;
  try {
    pdfBase64 = await imageToPdfBase64(Buffer.from(imageBase64, 'base64'));
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `processing failed: ${e?.message || e}` }, { status: 500 });
  }

  const subject = loadNumber
    ? `Simon Express POD — Load #${loadNumber} | driver ${driverName}`
    : `Simon Express POD — Load UNKNOWN | driver ${driverName}`;
  const html = `<div style="font-family:system-ui,Arial,sans-serif;color:#18181b">`
    + `<p>POD received via driver text.</p>`
    + `<p><strong>Driver:</strong> ${driverName}<br><strong>Load #:</strong> ${loadNumber || 'UNKNOWN — please identify'}</p></div>`;
  const fileName = `POD_${loadNumber || 'UNKNOWN'}_${driverName.replace(/\s+/g, '_')}.pdf`;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: process.env.FROM_EMAIL || 'docs@simonexpress.com',
    to: process.env.TO_EMAIL || 'billing@simonexpress.com',
    subject,
    html,
    attachments: [{ filename: fileName, content: pdfBase64 }],
  });
  if (error) return NextResponse.json({ ok: false, error: String(error) }, { status: 502 });
  return NextResponse.json({ ok: true, emailId: data?.id ?? null });
}
