'use client'

import { useState, useRef, useCallback } from 'react'
import styles from './page.module.css'

type Tag = 'bol' | 'lumper' | 'receipt' | 'other'

interface DocFile {
  id: number
  file: File
  tag: Tag | null
  previewUrl: string | null
  bwDataUrl: string | null
}

const TAG_LABELS: Record<Tag, string> = {
  bol: 'BOL',
  lumper: 'Lumper',
  receipt: 'Receipt',
  other: 'Other',
}

const TAG_COLORS: Record<Tag, { bg: string; color: string; activeBg: string; activeColor: string; border: string }> = {
  bol:     { bg: 'rgba(37,99,235,0.08)',  color: '#1D4ED8', activeBg: '#1D4ED8', activeColor: '#fff', border: 'rgba(37,99,235,0.22)' },
  lumper:  { bg: 'rgba(22,163,74,0.10)',  color: '#15803D', activeBg: '#15803D', activeColor: '#fff', border: 'rgba(22,163,74,0.22)' },
  receipt: { bg: 'rgba(202,138,4,0.10)',  color: '#A16207', activeBg: '#A16207', activeColor: '#fff', border: 'rgba(202,138,4,0.24)' },
  other:   { bg: 'rgba(107,111,118,0.10)', color: 'var(--steel)', activeBg: 'var(--ink)', activeColor: '#fff', border: 'rgba(107,111,118,0.22)' },
}

const GROUP_LABELS: Record<Tag, string> = {
  bol: 'Bill_of_Lading',
  lumper: 'Lumper_Receipt',
  receipt: 'Receipt',
  other: 'Other_Documents',
}

type AppScreen = 'form' | 'sending' | 'success' | 'error'

// Vercel serverless hard limit is 4.5 MB. We target 3.5 MB per batch to stay safely under.
const MAX_PAYLOAD_BYTES = 3.5 * 1024 * 1024

function estimatePayloadBytes(docs: DocFile[]): number {
  return docs.reduce((sum, d) => {
    const dataUrl = d.bwDataUrl || d.previewUrl || ''
    // base64 string length → raw bytes ≈ length * 0.75
    return sum + Math.round(dataUrl.length * 0.75)
  }, 0)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── CamScan-style adaptive binarization ──────────────────────────
// Converts a color photo to clean black & white using adaptive
// thresholding — handles shadows, glare and uneven lighting
function applyBW(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const MAX = 1400
      let w = img.naturalWidth
      let h = img.naturalHeight
      if (w > MAX || h > MAX) {
        const s = Math.min(MAX / w, MAX / h)
        w = Math.round(w * s)
        h = Math.round(h * s)
      }

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)

      const imageData = ctx.getImageData(0, 0, w, h)
      const data = imageData.data

      // Step 1: grayscale
      const gray = new Uint8Array(w * h)
      for (let i = 0; i < w * h; i++) {
        gray[i] = Math.round(
          0.299 * data[i * 4] +
          0.587 * data[i * 4 + 1] +
          0.114 * data[i * 4 + 2]
        )
      }

      // Step 2: build integral image for fast local mean calculation
      const integral = new Float64Array((w + 1) * (h + 1))
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          integral[(y + 1) * (w + 1) + (x + 1)] =
            gray[y * w + x] +
            integral[y * (w + 1) + (x + 1)] +
            integral[(y + 1) * (w + 1) + x] -
            integral[y * (w + 1) + x]
        }
      }

      // Step 3: adaptive threshold per pixel
      // blockSize ~1/16 of shortest dimension, C=10 bias toward white
      const blockSize = Math.max(21, Math.round(Math.min(w, h) / 16)) | 1
      const half = Math.floor(blockSize / 2)
      const C = 10

      const out = new Uint8Array(w * h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const x1 = Math.max(0, x - half)
          const y1 = Math.max(0, y - half)
          const x2 = Math.min(w - 1, x + half)
          const y2 = Math.min(h - 1, y + half)
          const count = (x2 - x1 + 1) * (y2 - y1 + 1)
          const sum =
            integral[(y2 + 1) * (w + 1) + (x2 + 1)] -
            integral[y1 * (w + 1) + (x2 + 1)] -
            integral[(y2 + 1) * (w + 1) + x1] +
            integral[y1 * (w + 1) + x1]
          const mean = sum / count
          out[y * w + x] = gray[y * w + x] < mean - C ? 0 : 255
        }
      }

      // Step 4: write pure black & white back to canvas
      for (let i = 0; i < w * h; i++) {
        const v = out[i]
        data[i * 4] = v
        data[i * 4 + 1] = v
        data[i * 4 + 2] = v
        data[i * 4 + 3] = 255
      }
      ctx.putImageData(imageData, 0, 0)

      resolve(canvas.toDataURL('image/jpeg', 0.6))
    }
    img.src = dataUrl
  })
}

export default function Home() {
  const [docs, setDocs] = useState<DocFile[]>([])
  const [driverName, setDriverName] = useState('')
  const [loadNumber, setLoadNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [ccEmail, setCcEmail] = useState('')
  const [screen, setScreen] = useState<AppScreen>('form')
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const idRef = useRef(0)

  const readDataUrl = (file: File): Promise<string> =>
    new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = (e) => res(e.target?.result as string)
      r.onerror = rej
      r.readAsDataURL(file)
    })

  const addFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const id = ++idRef.current
      const doc: DocFile = { id, file, tag: null, previewUrl: null, bwDataUrl: null }

      if (file.type.startsWith('image/')) {
        const original = await readDataUrl(file)
        doc.previewUrl = original
        // Process B&W immediately and store result
        const bw = await applyBW(original)
        doc.bwDataUrl = bw
      }

      setDocs((prev) => [...prev, doc])
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files))
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files) addFiles(Array.from(e.dataTransfer.files))
  }

  const setTag = (id: number, tag: Tag) => {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, tag } : d)))
  }

  const removeDoc = (id: number) => {
    setDocs((prev) => prev.filter((d) => d.id !== id))
  }

  const counts = {
    bol: docs.filter((d) => d.tag === 'bol').length,
    lumper: docs.filter((d) => d.tag === 'lumper').length,
    receipt: docs.filter((d) => d.tag === 'receipt').length,
    other: docs.filter((d) => d.tag === 'other').length,
  }

  const allTagged = docs.length > 0 && docs.every((d) => d.tag !== null)
  const loadOk = loadNumber.trim().length > 0

  const buildPdf = async (groupDocs: DocFile[]): Promise<string> => {
    // @ts-ignore
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    let first = true

    for (const doc of groupDocs) {
      if (!first) pdf.addPage()
      first = false

      if (doc.file.type === 'application/pdf') {
        pdf.setFontSize(13)
        pdf.text(`PDF attachment: ${doc.file.name}`, 15, 30)
        pdf.setFontSize(10)
        pdf.text('(Original PDF included)', 15, 42)
      } else {
        // Always use the B&W processed version — never the original color photo
        let dataUrl = doc.bwDataUrl
        if (!dataUrl) {
          // Fallback: process now if somehow not done yet
          const original = await readDataUrl(doc.file)
          dataUrl = await applyBW(original)
        }

        const imgProps = pdf.getImageProperties(dataUrl)
        const pageW = 210, pageH = 297, margin = 10
        const maxW = pageW - margin * 2
        const maxH = pageH - margin * 2
        let w = imgProps.width
        let h = imgProps.height
        if (w > maxW) { h = (h * maxW) / w; w = maxW }
        if (h > maxH) { w = (w * maxH) / h; h = maxH }
        pdf.addImage(dataUrl, 'JPEG', margin, margin, w, h)
      }
    }

    const dataUri = pdf.output('datauristring')
    return dataUri.split(',')[1]
  }

  // Split attachments into batches that each fit under MAX_PAYLOAD_BYTES
  const splitIntoBatches = (
    attachments: { name: string; base64: string; label: string; count: number; estBytes: number }[]
  ) => {
    const batches: typeof attachments[] = []
    let current: typeof attachments = []
    let currentSize = 0
    for (const att of attachments) {
      if (att.estBytes > MAX_PAYLOAD_BYTES) {
        if (current.length > 0) { batches.push(current); current = []; currentSize = 0 }
        batches.push([att])
        continue
      }
      if (currentSize + att.estBytes > MAX_PAYLOAD_BYTES && current.length > 0) {
        batches.push(current)
        current = []
        currentSize = 0
      }
      current.push(att)
      currentSize += att.estBytes
    }
    if (current.length > 0) batches.push(current)
    return batches
  }

  const handleSubmit = async () => {
    setScreen('sending')
    setProgress(5)
    setStatusMsg('Grouping documents...')

    try {
      const groups: Record<Tag, DocFile[]> = { bol: [], lumper: [], receipt: [], other: [] }
      docs.forEach((d) => { if (d.tag) groups[d.tag].push(d) })

      setProgress(20)
      setStatusMsg('Applying B&W scan processing...')

      const attachments: { name: string; base64: string; label: string; count: number; estBytes: number }[] = []
      const tags: Tag[] = ['bol', 'lumper', 'receipt', 'other']
      for (const tag of tags) {
        if (groups[tag].length === 0) continue
        setStatusMsg(`Converting ${GROUP_LABELS[tag].replace(/_/g, ' ')} to PDF...`)
        const base64 = await buildPdf(groups[tag])
        const estBytes = Math.round(base64.length * 0.75)
        attachments.push({
          name: `${GROUP_LABELS[tag]}.pdf`,
          base64,
          label: GROUP_LABELS[tag].replace(/_/g, ' '),
          count: groups[tag].length,
          estBytes,
        })
        setProgress(20 + (attachments.length / tags.length) * 40)
      }

      // Split into batches if total size exceeds limit
      const batches = splitIntoBatches(attachments)
      const totalBatches = batches.length

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        const batchLabel = totalBatches > 1 ? ` (Part ${i + 1} of ${totalBatches})` : ''
        setProgress(60 + (i / totalBatches) * 35)
        setStatusMsg(
          totalBatches > 1
            ? `Sending batch ${i + 1} of ${totalBatches} to billing...`
            : 'Sending to billing...'
        )

        const sendAttachments = batch.map(({ estBytes: _e, ...rest }) => rest)

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 60000)

        const res = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            driverName: driverName || 'Driver',
            loadNumber,
            notes,
            ccEmail: ccEmail.trim() || undefined,
            attachments: sendAttachments,
            batchLabel,
          }),
        })
        clearTimeout(timeout)

        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Send failed')
      }

      setProgress(100)
      setStatusMsg('Done!')
      await new Promise((r) => setTimeout(r, 400))
      const batchNote = totalBatches > 1 ? ` (sent in ${totalBatches} emails due to size)` : ''
      setSuccessMsg(`Load #${loadNumber} B&W scans sent to billing@simonexpress.com${batchNote}.`)
      setScreen('success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      if (msg.includes('abort') || msg.includes('AbortError') || (err instanceof Error && err.name === 'AbortError')) {
        setErrorMsg('The request timed out — but your documents may have still been sent. Please check with billing before trying again.')
      } else {
        setErrorMsg(msg)
      }
      setScreen('error')
    }
  }

  const resetForm = () => {
    setDocs([])
    setDriverName('')
    setLoadNumber('')
    setNotes('')
    setCcEmail('')
    setProgress(0)
    setScreen('form')
  }

  return (
    <div className={styles.app}>
      <div className={styles.topBar}>
        <a href="/" className={styles.backPill}>← Back</a>
      </div>
      <h1 className={styles.screenTitle}>Document Submission</h1>
      <p className={styles.screenSubtitle}>Submit BOL, lumper receipts &amp; paperwork</p>

      {screen === 'form' && (
        <main className={styles.formView}>
          <section className={styles.section}>
            <p className={styles.sectionLabel}>Driver Info</p>
            <div className={styles.card}>
              <input className={styles.input} type="text" placeholder="Driver name" value={driverName} onChange={(e) => setDriverName(e.target.value)} autoComplete="off" />
              <input className={`${styles.input} ${!loadOk && loadNumber !== '' ? styles.requiredEmpty : ''}`} type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Load Number - Required" value={loadNumber} onChange={(e) => setLoadNumber(e.target.value)} autoComplete="off" />
              <input className={styles.input} type="text" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" />
              <input className={styles.input} type="email" inputMode="email" placeholder="CC your email (optional)" value={ccEmail} onChange={(e) => setCcEmail(e.target.value)} autoComplete="email" />
            </div>
          </section>

          <section className={styles.section}>
            <p className={styles.sectionLabel}>Add Documents</p>
            <div
              className={`${styles.uploadZone} ${isDragOver ? styles.dragOver : ''}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple onChange={handleFileChange} style={{ display: 'none' }} />
              <div className={styles.uploadIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D71920" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
              <p className={styles.uploadTitle}>Tap to photograph or upload</p>
              <p className={styles.uploadSub}>Images or PDFs · Multiple files at once</p>
            </div>

            <div className={styles.scanInfo}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>
              </svg>
              Photos auto-converted to clean B&amp;W scans before sending
            </div>

            {docs.length === 0 && <p className={styles.emptyState}>No documents added yet</p>}

            <div className={styles.docsList}>
              {docs.map((doc) => (
                <div key={doc.id} className={styles.docCard}>
                  <div className={styles.docThumbWrap}>
                    {doc.bwDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={doc.bwDataUrl} alt="B&W scan preview" className={styles.docThumb} />
                    ) : doc.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={doc.previewUrl} alt="preview" className={styles.docThumb} />
                    ) : (
                      <div className={styles.docThumbIcon}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                        </svg>
                      </div>
                    )}
                    {doc.bwDataUrl && <span className={styles.scanBadge}>B&amp;W</span>}
                  </div>
                  <div className={styles.docInfo}>
                    <p className={styles.docName}>
                      {doc.file.name.length > 24 ? doc.file.name.slice(0, 22) + '…' : doc.file.name}
                    </p>
                    <div className={styles.tagRow}>
                      {(Object.keys(TAG_LABELS) as Tag[]).map((t) => {
                        const active = doc.tag === t
                        const c = TAG_COLORS[t]
                        return (
                          <button key={t} onClick={() => setTag(doc.id, t)}
                            style={{ background: active ? c.activeBg : c.bg, color: active ? c.activeColor : c.color, borderColor: active ? c.activeBg : c.border }}
                            className={styles.tag}>
                            {TAG_LABELS[t]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <button className={styles.removeBtn} onClick={() => removeDoc(doc.id)} title="Remove">×</button>
                </div>
              ))}
            </div>

            {docs.length > 0 && (
              <div className={styles.summaryBar}>
                <span className={styles.summaryChip}><span className={styles.dot} style={{ background: '#1D4ED8' }}/>{counts.bol} BOL</span>
                <span className={styles.summaryChip}><span className={styles.dot} style={{ background: '#15803D' }}/>{counts.lumper} Lumper</span>
                <span className={styles.summaryChip}><span className={styles.dot} style={{ background: '#A16207' }}/>{counts.receipt} Receipt</span>
                <span className={styles.summaryChip}><span className={styles.dot} style={{ background: 'var(--steel)' }}/>{counts.other} Other</span>
                <span className={styles.summaryTotal}>{docs.length} total</span>
                {(() => {
                  const bytes = estimatePayloadBytes(docs)
                  const batches = Math.ceil(bytes / MAX_PAYLOAD_BYTES)
                  return (
                    <span className={styles.summaryTotal} style={{ color: '#888', marginLeft: 4 }}>
                      {formatBytes(bytes)}{batches > 1 ? ` · ${batches} emails` : ''}
                    </span>
                  )
                })()}
              </div>
            )}
          </section>

          <section className={styles.section} style={{ marginBottom: 24 }}>
            <button className={styles.submitBtn} disabled={!allTagged || !loadOk} onClick={handleSubmit}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/>
              </svg>
              Send to Billing
            </button>
            {docs.length > 0 && !allTagged && <p className={styles.untaggedNote}>Tag all documents before submitting</p>}
            {docs.length > 0 && allTagged && !loadOk && <p className={styles.untaggedNote}>Load number is required</p>}
            <p className={styles.destinationNote}>Sends to billing@simonexpress.com</p>
          </section>
        </main>
      )}

      {screen === 'sending' && (
        <div className={styles.statusScreen}>
          <div className={styles.spinner} />
          <p className={styles.statusTitle}>Processing...</p>
          <div className={styles.progressWrap}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
          <p className={styles.statusSub}>{statusMsg}</p>
        </div>
      )}

      {screen === 'success' && (
        <div className={styles.statusScreen}>
          <div className={styles.statusIcon} style={{ background: 'rgba(22,163,74,0.10)', border: '1px solid rgba(22,163,74,0.20)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <p className={styles.statusTitle}>Submitted!</p>
          <p className={styles.statusSub}>{successMsg}</p>
          <button className={styles.newBtn} onClick={resetForm}>Submit Another Load</button>
        </div>
      )}

      {screen === 'error' && (
        <div className={styles.statusScreen}>
          <div className={styles.statusIcon} style={{ background: 'rgba(215,25,32,0.08)', border: '1px solid rgba(215,25,32,0.20)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D71920" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <p className={styles.statusTitle}>Send Failed</p>
          <p className={styles.statusSub} style={{ whiteSpace: 'pre-line' }}>{errorMsg}</p>
          <button className={styles.newBtn} onClick={() => setScreen('form')}>Try Again</button>
        </div>
      )}
    </div>
  )
}
