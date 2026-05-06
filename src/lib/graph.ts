// Microsoft Graph helper for app-only authentication and Outlook mail operations.
// Used by the daily fuel-ingest cron job to pull Pilot Flying J pricing emails
// from a designated Outlook folder, parse them, and archive them.
//
// Required env vars:
//   AZURE_TENANT_ID         — Directory (tenant) ID from Azure AD app registration
//   AZURE_CLIENT_ID         — Application (client) ID from Azure AD app registration
//   AZURE_CLIENT_SECRET     — Client secret value (NOT the secret ID)
//   OUTLOOK_FUEL_MAILBOX    — Mailbox UPN (e.g. jfishback@simonexpress.com)
//   OUTLOOK_FUEL_FOLDER     — Display name of folder containing fuel emails (e.g. KPI-FEED)
//   OUTLOOK_PROCESSED_FOLDER — (optional) Display name of subfolder to move processed emails to (e.g. Processed)

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

// In-memory token cache. Tokens last 60 minutes; we refresh 2 min before expiry.
let cachedToken: { value: string; expiresAt: number } | null = null

/**
 * Acquire an app-only access token using the client credentials flow.
 * Caches the token in memory to avoid re-fetching on every Graph call within the same invocation.
 */
export async function getGraphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 120_000) {
    return cachedToken.value
  }

  const tenantId = process.env.AZURE_TENANT_ID
  const clientId = process.env.AZURE_CLIENT_ID
  const clientSecret = process.env.AZURE_CLIENT_SECRET

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Azure credentials. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.')
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  })

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to get Graph token: ${res.status} ${text}`)
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
  return cachedToken.value
}

/**
 * Lightweight Graph fetch wrapper. Auto-attaches the bearer token and parses JSON.
 */
async function graph<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getGraphToken()
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph ${init?.method || 'GET'} ${path} failed: ${res.status} ${text}`)
  }
  // Some endpoints (e.g. delete/move) return 204 No Content
  if (res.status === 204) return null as unknown as T
  return (await res.json()) as T
}

/**
 * Look up a mail folder's ID by display name. Searches inside the mailbox's root.
 * Optionally accepts a parent folder ID to look for child folders.
 */
export async function findFolderIdByName(mailbox: string, name: string, parentId?: string): Promise<string | null> {
  const path = parentId
    ? `/users/${encodeURIComponent(mailbox)}/mailFolders/${parentId}/childFolders?$filter=displayName eq '${escapeOData(name)}'&$select=id,displayName`
    : `/users/${encodeURIComponent(mailbox)}/mailFolders?$filter=displayName eq '${escapeOData(name)}'&$select=id,displayName`
  const res = await graph<{ value: Array<{ id: string; displayName: string }> }>(path)
  return res.value[0]?.id ?? null
}

/**
 * Get or create a child folder by display name under a parent folder.
 * Used to ensure the "Processed" subfolder exists.
 */
export async function ensureChildFolder(mailbox: string, parentId: string, name: string): Promise<string> {
  const existing = await findFolderIdByName(mailbox, name, parentId)
  if (existing) return existing
  const created = await graph<{ id: string }>(
    `/users/${encodeURIComponent(mailbox)}/mailFolders/${parentId}/childFolders`,
    { method: 'POST', body: JSON.stringify({ displayName: name }) }
  )
  return created.id
}

export interface FuelMessage {
  id: string
  subject: string
  receivedDateTime: string
  from?: string
}

/**
 * List unread messages in a folder that match the Pilot Flying J pricing criteria.
 * Returns messages sorted oldest-first so we process them in order.
 */
export async function listFuelMessages(mailbox: string, folderId: string, fromAddress: string, subjectContains: string): Promise<FuelMessage[]> {
  // Filter to unread + from + subject. Graph's $search supports phrase searches but
  // can't be combined with $filter, so we use $filter for the strict match and
  // do subject-contains client-side after retrieving.
  const filter = `isRead eq false`
  const path = `/users/${encodeURIComponent(mailbox)}/mailFolders/${folderId}/messages?$filter=${encodeURIComponent(filter)}&$select=id,subject,receivedDateTime,from&$orderby=receivedDateTime asc&$top=20`
  const res = await graph<{ value: Array<{ id: string; subject: string; receivedDateTime: string; from?: { emailAddress?: { address?: string } } }> }>(path)
  return res.value
    .filter(m => { const senderOk = (m.from?.emailAddress?.address || '').toLowerCase() === fromAddress.toLowerCase(); const subjectOk = (m.subject || '').toLowerCase().includes(subjectContains.toLowerCase()); return senderOk && subjectOk; })
    .map(m => ({
      id: m.id,
      subject: m.subject,
      receivedDateTime: m.receivedDateTime,
      from: m.from?.emailAddress?.address,
    }))
}

export interface FuelAttachment {
  id: string
  name: string
  contentType: string
  contentBytes: string  // base64-encoded
  size: number
}

/**
 * List attachments on a message and return them with their base64 contents.
 * Pilot's daily price email typically has one CSV or XLSX attachment.
 */
export async function getMessageAttachments(mailbox: string, messageId: string): Promise<FuelAttachment[]> {
  const path = `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments?$select=id,name,contentType,size,contentBytes`
  const res = await graph<{ value: Array<{ id: string; name: string; contentType: string; size: number; contentBytes: string; '@odata.type'?: string }> }>(path)
  // Only file attachments have contentBytes; ignore item attachments and inline references
  return res.value
    .filter(a => a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.contentBytes)
    .map(a => ({
      id: a.id,
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
      size: a.size,
    }))
}

/**
 * Mark a message as read. We do this when no attachment was found so we don't
 * keep retrying the same message on every poll.
 */
export async function markMessageRead(mailbox: string, messageId: string): Promise<void> {
  await graph(`/users/${encodeURIComponent(mailbox)}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isRead: true }),
  })
}

/**
 * Move a message to a different folder. Used to archive successfully-processed emails
 * to the Processed subfolder so the main folder stays clean.
 */
export async function moveMessage(mailbox: string, messageId: string, destinationFolderId: string): Promise<void> {
  await graph(`/users/${encodeURIComponent(mailbox)}/messages/${messageId}/move`, {
    method: 'POST',
    body: JSON.stringify({ destinationId: destinationFolderId }),
  })
}

/** Escape single quotes for OData string filters. */
function escapeOData(s: string): string {
  return s.replace(/'/g, "''")
}


