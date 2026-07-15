const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
let cachedToken: { value: string; expiresAt: number; viaOidc: boolean } | null = null

export async function getGraphToken(opts?: { skipOidc?: boolean }): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 120_000 && !(opts?.skipOidc && cachedToken.viaOidc)) {
    return cachedToken.value
  }
  const tenantId = process.env.AZURE_TENANT_ID
  const clientId = process.env.AZURE_CLIENT_ID
  if (!tenantId || !clientId) throw new Error('Missing AZURE_TENANT_ID or AZURE_CLIENT_ID.')

  // Prefer Vercel OIDC federated credentials (no secret rotation needed).
  // VERCEL_OIDC_TOKEN is auto-injected when OIDC is enabled on the Vercel
  // project AND Microsoft Entra has a Federated Credential registered for
  // this app pointing to Vercel's issuer with the matching subject claim.
  // Falls back to AZURE_CLIENT_SECRET if OIDC isn't configured — or, via
  // skipOidc, when an OIDC-minted token was just REJECTED by Graph: the
  // 7/15 deploy started injecting VERCEL_OIDC_TOKEN and Graph bounced its
  // exchanged tokens with "Lifetime validation failed" while the client
  // secret kept working, which took the fuel cron down.
  const oidcToken = opts?.skipOidc ? undefined : process.env.VERCEL_OIDC_TOKEN
  const clientSecret = process.env.AZURE_CLIENT_SECRET
  if (!oidcToken && !clientSecret) {
    throw new Error('Neither VERCEL_OIDC_TOKEN nor AZURE_CLIENT_SECRET is set (or OIDC skipped with no secret fallback).')
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    scope: 'https://graph.microsoft.com/.default',
  })
  if (oidcToken) {
    body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer')
    body.set('client_assertion', oidcToken)
  } else {
    body.set('client_secret', clientSecret!)
  }

  const res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), cache: 'no-store' })
  const azureDate = res.headers.get('date')
  if (!res.ok) {
    const text = await res.text()
    const mode = oidcToken ? 'OIDC federation' : 'client_secret'
    // OIDC exchange refused and we have a secret → try the secret path.
    if (oidcToken && clientSecret) {
      console.warn(`Graph token via OIDC failed (${res.status}) — falling back to client_secret`)
      return getGraphToken({ skipOidc: true })
    }
    throw new Error(`Failed to get Graph token (${mode}): ${res.status} ${text}`)
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  // TEMP DIAG (fuel-graph-diag): distinguish clock-skew vs stale-token. Log the
  // token's iat/nbf/exp, the lambda's raw now, and Azure's own Date header.
  try {
    const p = JSON.parse(Buffer.from(json.access_token.split('.')[1], 'base64').toString())
    const nowMs = Date.now()
    const now = Math.floor(nowMs / 1000)
    console.log(`[graph-diag] via ${oidcToken ? 'OIDC' : 'client_secret'} appid=${p.appid} | lambda_now=${now} (${new Date(nowMs).toISOString()}) | azure_date=${azureDate} | tok.iat=${p.iat} tok.nbf=${p.nbf} tok.exp=${p.exp} | exp-now=${p.exp - now}s iat-now=${p.iat - now}s`)
  } catch (e: any) { console.log(`[graph-diag] token decode failed: ${e?.message}`) }
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000, viaOidc: !!oidcToken }
  return cachedToken.value
}

async function graph<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getGraphToken()
  let res = await fetch(`${GRAPH_BASE}${path}`, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
  if (res.status === 401 && process.env.AZURE_CLIENT_SECRET) {
    // Graph rejected the token (seen with OIDC-minted tokens: "Lifetime
    // validation failed"). Re-mint via client secret and retry once.
    console.log(`[graph-diag] 401 on ${init?.method || 'GET'} ${path.split('?')[0]} — re-minting via client_secret and retrying`)
    cachedToken = null
    const retryToken = await getGraphToken({ skipOidc: true })
    res = await fetch(`${GRAPH_BASE}${path}`, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${retryToken}`, 'Content-Type': 'application/json' } })
    console.log(`[graph-diag] retry status: ${res.status}`)
  }
  if (!res.ok) { const text = await res.text(); throw new Error(`Graph ${init?.method || 'GET'} ${path} failed: ${res.status} ${text}`) }
  if (res.status === 204) return null as unknown as T
  return (await res.json()) as T
}

async function listAllFolders(mailbox: string, parentId?: string): Promise<Array<{ id: string; displayName: string }>> {
  const path = parentId
    ? `/users/${encodeURIComponent(mailbox)}/mailFolders/${parentId}/childFolders?$select=id,displayName&$top=100`
    : `/users/${encodeURIComponent(mailbox)}/mailFolders?$select=id,displayName&$top=100`
  const res = await graph<{ value: Array<{ id: string; displayName: string }> }>(path)
  return res.value
}

export async function findFolderIdByName(mailbox: string, name: string, parentId?: string): Promise<string | null> {
  const folders = await listAllFolders(mailbox, parentId)
  const target = name.toLowerCase().trim()
  const match = folders.find(f => (f.displayName || '').toLowerCase().trim() === target)
  return match?.id ?? null
}

export async function ensureChildFolder(mailbox: string, parentId: string, name: string): Promise<string> {
  const existing = await findFolderIdByName(mailbox, name, parentId)
  if (existing) return existing
  try {
    const created = await graph<{ id: string }>(`/users/${encodeURIComponent(mailbox)}/mailFolders/${parentId}/childFolders`, { method: 'POST', body: JSON.stringify({ displayName: name }) })
    return created.id
  } catch (err: any) {
    const msg = String(err?.message || '')
    if (msg.includes('ErrorFolderExists') || msg.includes('409')) {
      const retry = await listAllFolders(mailbox, parentId)
      const fallback = retry.find(f => (f.displayName || '').toLowerCase().trim() === name.toLowerCase().trim())
      if (fallback) return fallback.id
      const partial = retry.find(f => (f.displayName || '').toLowerCase().includes(name.toLowerCase()))
      if (partial) return partial.id
    }
    throw err
  }
}

export interface FuelMessage { id: string; subject: string; receivedDateTime: string; from?: string }

// List candidate feed messages in the folder. Deliberately NO server-side
// $filter: Graph's filtered folder views are eventually consistent and can
// omit recently-arrived items for hours (the unread 7/14 Pilot email sat
// invisible to `$filter=isRead eq false` for ~20h while showing up fine in a
// plain listing). The folder only ever holds a handful of messages, so we
// pull the newest 25 and filter unread/sender/subject in code.
export async function listFuelMessages(mailbox: string, folderId: string, fromAddress: string, subjectContains: string): Promise<FuelMessage[]> {
  const path = `/users/${encodeURIComponent(mailbox)}/mailFolders/${folderId}/messages?$select=id,subject,receivedDateTime,from,isRead&$orderby=receivedDateTime desc&$top=25`
  const res = await graph<{ value: Array<{ id: string; subject: string; receivedDateTime: string; isRead?: boolean; from?: { emailAddress?: { address?: string } } }> }>(path)
  return res.value
    .filter(m => {
      if (m.isRead) return false
      const sender = (m.from?.emailAddress?.address || '').toLowerCase()
      const want = fromAddress.toLowerCase()
      // Exact address, or "@domain.com" to match any sender at that domain.
      const senderOk = want.startsWith('@') ? sender.endsWith(want) : sender === want
      const subjectOk = (m.subject || '').toLowerCase().includes(subjectContains.toLowerCase())
      return senderOk && subjectOk
    })
    .map(m => ({ id: m.id, subject: m.subject, receivedDateTime: m.receivedDateTime, from: m.from?.emailAddress?.address }))
    .reverse() // oldest first so multiple pending days apply in order
}

export interface FuelAttachment { id: string; name: string; contentType: string; contentBytes: string; size: number }

export async function getMessageAttachments(mailbox: string, messageId: string): Promise<FuelAttachment[]> {
  const path = `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments`
  const res = await graph<{ value: Array<{ id: string; name: string; contentType: string; size: number; contentBytes: string; '@odata.type'?: string }> }>(path)
  return res.value
    .filter(a => a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.contentBytes)
    .map(a => ({ id: a.id, name: a.name, contentType: a.contentType, contentBytes: a.contentBytes, size: a.size }))
}

export async function markMessageRead(mailbox: string, messageId: string): Promise<void> {
  await graph(`/users/${encodeURIComponent(mailbox)}/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ isRead: true }) })
}

export async function moveMessage(mailbox: string, messageId: string, destinationFolderId: string): Promise<void> {
  await graph(`/users/${encodeURIComponent(mailbox)}/messages/${messageId}/move`, { method: 'POST', body: JSON.stringify({ destinationId: destinationFolderId }) })
}

// Delete (to Deleted Items). A 404 means another run already handled it —
// concurrent cron fires raced on this before — so treat it as success.
export async function deleteMessage(mailbox: string, messageId: string): Promise<void> {
  try {
    await graph(`/users/${encodeURIComponent(mailbox)}/messages/${messageId}`, { method: 'DELETE' })
  } catch (err: any) {
    const msg = String(err?.message || '')
    if (msg.includes(' 404 ') || msg.includes('ErrorItemNotFound')) return
    throw err
  }
}

