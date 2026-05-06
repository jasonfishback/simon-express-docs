const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
let cachedToken: { value: string; expiresAt: number } | null = null

export async function getGraphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 120_000) return cachedToken.value
  const tenantId = process.env.AZURE_TENANT_ID
  const clientId = process.env.AZURE_CLIENT_ID
  const clientSecret = process.env.AZURE_CLIENT_SECRET
  if (!tenantId || !clientId || !clientSecret) throw new Error('Missing Azure credentials.')
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default' })
  const res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
  if (!res.ok) { const text = await res.text(); throw new Error(`Failed to get Graph token: ${res.status} ${text}`) }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return cachedToken.value
}

async function graph<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getGraphToken()
  const res = await fetch(`${GRAPH_BASE}${path}`, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
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

export async function listFuelMessages(mailbox: string, folderId: string, fromAddress: string, subjectContains: string): Promise<FuelMessage[]> {
  const path = `/users/${encodeURIComponent(mailbox)}/mailFolders/${folderId}/messages?$filter=isRead eq false&$select=id,subject,receivedDateTime,from&$orderby=receivedDateTime asc&$top=20`
  const res = await graph<{ value: Array<{ id: string; subject: string; receivedDateTime: string; from?: { emailAddress?: { address?: string } } }> }>(path)
  return res.value
    .filter(m => {
      const senderOk = (m.from?.emailAddress?.address || '').toLowerCase() === fromAddress.toLowerCase()
      const subjectOk = (m.subject || '').toLowerCase().includes(subjectContains.toLowerCase())
      return senderOk && subjectOk
    })
    .map(m => ({ id: m.id, subject: m.subject, receivedDateTime: m.receivedDateTime, from: m.from?.emailAddress?.address }))
}

export interface FuelAttachment { id: string; name: string; contentType: string; contentBytes: string; size: number }

export async function getMessageAttachments(mailbox: string, messageId: string): Promise<FuelAttachment[]> {
  const path = `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments?$select=id,name,contentType,size,contentBytes`
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
