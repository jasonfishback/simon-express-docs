// src/lib/docs-process.ts
//
// Server-side document processing for the programmatic POD ingest: turn a color
// photo into a bitonal (black & white) JPEG and wrap it in a single-page PDF.
// Mirrors the browser applyBW()/buildPdf() in src/app/docs/page.tsx, server-side.

import sharp from 'sharp';
import { jsPDF } from 'jspdf';

export async function toBwJpeg(input: Buffer): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const img = sharp(input).rotate(); // honor EXIF orientation
  const resized = img.resize({ width: 1700, height: 1700, fit: 'inside', withoutEnlargement: true })
    .grayscale().normalize().threshold(170); // bitonal, bias toward white
  const jpeg = await resized.jpeg({ quality: 72 }).toBuffer();
  const meta = await sharp(jpeg).metadata();
  return { jpeg, width: meta.width ?? 1700, height: meta.height ?? 2200 };
}

export async function imageToPdfBase64(input: Buffer): Promise<string> {
  const { jpeg, width, height } = await toBwJpeg(input);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 24;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const scale = Math.min(maxW / width, maxH / height);
  const w = width * scale;
  const h = height * scale;
  const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  doc.addImage(dataUrl, 'JPEG', (pageW - w) / 2, (pageH - h) / 2, w, h);
  const buf = doc.output('arraybuffer') as ArrayBuffer;
  return Buffer.from(buf).toString('base64');
}
