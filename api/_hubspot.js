// Thin wrapper around the HubSpot API. All calls use the private-app token
// server-side only (HUBSPOT_TOKEN) — it never reaches the browser.
//
// IMPORTANT — the "Primary" association type ID is looked up dynamically,
// not hardcoded. HubSpot's default contact<->deal association type IDs
// differ per portal / API version, and guessing wrong would silently
// attach the wrong deal (or none) to every contact. getPrimaryDealTypeId()
// asks HubSpot's own Associations Schema API which type is labeled
// "Primary" and caches it for the life of the serverless instance. If your
// portal's label is spelled differently than "Primary", update the regex
// below (search for PRIMARY_LABEL_RE) — and check the console warning that
// fires when no match is found, which falls back to the unlabeled default
// association instead of failing outright.

const HUBSPOT_BASE = 'https://api.hubapi.com'
const PRIMARY_LABEL_RE = /\bprimary\b/i

async function hsFetch(path, opts = {}) {
  const token = process.env.HUBSPOT_TOKEN
  if (!token) throw new Error('Missing HUBSPOT_TOKEN env var')
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`HubSpot ${opts.method || 'GET'} ${path} failed: ${res.status} ${text}`)
    err.status = res.status
    throw err
  }
  if (res.status === 204) return null
  return res.json()
}

// ---------- Owners ----------

// Fetches every owner in the portal (paginated). Small enough per-portal
// that fetching fresh on each request is fine — no cross-request caching
// here since serverless instances aren't guaranteed to stay warm.
export async function getAllOwners() {
  const owners = []
  let after
  do {
    const qs = new URLSearchParams({ limit: '200' })
    if (after) qs.set('after', after)
    const page = await hsFetch(`/crm/v3/owners?${qs.toString()}`)
    owners.push(...(page.results || []))
    after = page.paging?.next?.after
  } while (after)
  return owners
}

export function findOwnerByEmail(owners, email) {
  const target = String(email || '').trim().toLowerCase()
  if (!target) return null
  return owners.find((o) => String(o.email || '').trim().toLowerCase() === target) || null
}

export function ownerLabel(owners, ownerId) {
  if (!ownerId) return null
  const o = owners.find((x) => String(x.id) === String(ownerId))
  if (!o) return `Owner ${ownerId}`
  const name = [o.firstName, o.lastName].filter(Boolean).join(' ')
  return name || o.email || `Owner ${ownerId}`
}

// ---------- Deal pipelines / stages ----------

let cachedStageLabels = null

// Maps a deal's raw `dealstage` property (an internal stage ID, not a
// human label) to its pipeline + stage labels, by asking HubSpot's
// Pipelines API. Cached for the life of the serverless instance.
export async function getDealStageLabels() {
  if (cachedStageLabels) return cachedStageLabels
  const data = await hsFetch('/crm/v3/pipelines/deals')
  const map = new Map()
  for (const pipeline of data.results || []) {
    for (const stage of pipeline.stages || []) {
      map.set(stage.id, {
        stageLabel: stage.label,
        pipelineId: pipeline.id,
        pipelineLabel: pipeline.label,
      })
    }
  }
  cachedStageLabels = map
  return cachedStageLabels
}

// ---------- Active List membership ----------

// v3 Lists API — works for both static and active (dynamic) lists; for an
// active list this always reflects current membership as HubSpot itself
// evaluates it, so there's no filter-criteria logic to replicate here.
export async function getListContactIds(listId) {
  const ids = []
  let after
  do {
    const qs = new URLSearchParams({ limit: '250' })
    if (after) qs.set('after', after)
    const page = await hsFetch(`/crm/v3/lists/${listId}/memberships?${qs.toString()}`)
    for (const r of page.results || []) ids.push(String(r.recordId))
    after = page.paging?.next?.after
  } while (after)
  return ids
}

// ---------- Batch object reads ----------

async function batchReadObjects(objectType, ids, properties) {
  if (ids.length === 0) return []
  const CHUNK = 100 // HubSpot's batch/read limit
  const out = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const page = await hsFetch(`/crm/v3/objects/${objectType}/batch/read`, {
      method: 'POST',
      body: JSON.stringify({ properties, inputs: chunk.map((id) => ({ id })) }),
    })
    out.push(...(page.results || []))
  }
  return out
}

export function batchReadContacts(ids, properties) {
  return batchReadObjects('contacts', ids, properties)
}

export function batchReadDeals(ids, properties) {
  return batchReadObjects('deals', ids, properties)
}

// ---------- Primary contact<->deal association ----------

let cachedPrimaryTypeId = null

// Asks the Associations Schema API which contact->deal association type is
// labeled "Primary" in this portal. Falls back to the first HUBSPOT_DEFINED
// (unlabeled) type if no "Primary" label exists, and logs a warning so a
// misconfigured portal is visible in the function logs rather than silently
// wrong.
async function getPrimaryDealTypeId() {
  if (cachedPrimaryTypeId !== null) return cachedPrimaryTypeId
  const schema = await hsFetch('/crm/v4/associations/contacts/deals/labels')
  const types = schema.results || []
  const primary = types.find((t) => t.label && PRIMARY_LABEL_RE.test(t.label))
  if (primary) {
    cachedPrimaryTypeId = primary.typeId
  } else {
    const fallback = types.find((t) => t.category === 'HUBSPOT_DEFINED') || types[0]
    console.warn(
      'ae-missing-properties: no contact->deal association type labeled "Primary" was found in this portal. ' +
      'Falling back to the default unlabeled association type. If deals are pairing incorrectly, check how ' +
      'your portal labels the primary contact-deal association and adjust PRIMARY_LABEL_RE in api/_hubspot.js.'
    )
    cachedPrimaryTypeId = fallback ? fallback.typeId : null
  }
  return cachedPrimaryTypeId
}

// Batch-reads contact->deal associations for many contacts at once and
// returns a Map<contactId, dealId | null> keeping only the "Primary"-labeled
// association. If a contact has more than one deal labeled Primary (unusual
// but not impossible), the first one returned by HubSpot is used.
export async function getPrimaryDealIdsForContacts(contactIds) {
  const result = new Map(contactIds.map((id) => [id, null]))
  if (contactIds.length === 0) return result

  const primaryTypeId = await getPrimaryDealTypeId()
  const CHUNK = 100 // batch/read limit for associations too
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const chunk = contactIds.slice(i, i + CHUNK)
    const page = await hsFetch('/crm/v4/associations/contacts/deals/batch/read', {
      method: 'POST',
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
    })
    for (const item of page.results || []) {
      const contactId = String(item.from?.id)
      const assoc = (item.to || []).find((to) =>
        (to.associationTypes || []).some((t) => t.typeId === primaryTypeId)
      )
      if (assoc) result.set(contactId, String(assoc.toObjectId))
    }
  }
  return result
}
