// Vercel serverless function — the core of the app.
//
// Flow:
//   1. Read the Active List's current contact membership (HubSpot evaluates
//      the list's own filter criteria; we just read whoever is in it now).
//   2. Batch-read those contacts for the four tracked properties + owner.
//   3. Resolve each contact's PRIMARY associated deal (see _hubspot.js for
//      why that lookup is dynamic, not a hardcoded association type ID).
//   4. Batch-read those deals for name/stage/owner.
//   5. Split into:
//        - "mine": records whose primary deal's owner is the logged-in AE
//        - "unowned": records where the contact has no owner, OR has a
//          primary deal but that deal has no owner, OR has no primary deal
//          at all (surfaced too — a contact with no deal isn't something
//          this endpoint should silently drop, since that's exactly the
//          kind of data gap an AE should be able to see and fix).
// TESTING MODE: getSession/login is bypassed below (see the block marked
// "RE-ENABLE LOGIN HERE"). "Mine" is instead driven by an ?ownerId=
// query param so you can test the My List / Unowned split by picking any
// AE from the dropdown, without Google OAuth set up yet.
import { getSession } from './_auth.js' // eslint-disable-line no-unused-vars -- kept for the re-enable step below
import {
  getAllOwners,
  ownerLabel,
  getListContactIds,
  batchReadContacts,
  batchReadDeals,
  getPrimaryDealIdsForContacts,
} from './_hubspot.js'

// Only contact properties per the confirmed scope — these are NOT deal
// properties in this portal.
const TRACKED_CONTACT_PROPS = ['mql', 'sql', 'sal', 'initial_meeting_outcome']
const CONTACT_PROPS = ['email', 'firstname', 'lastname', 'hubspot_owner_id', ...TRACKED_CONTACT_PROPS]
const DEAL_PROPS = ['dealname', 'dealstage', 'hubspot_owner_id']

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === ''
}

export default async function handler(req, res) {
  // ---- RE-ENABLE LOGIN HERE ----
  // Swap this block back to the real session check when you're ready:
  //
  //   const session = getSession(req)
  //   if (!session) {
  //     res.status(401).json({ error: 'Not signed in' })
  //     return
  //   }
  //   const viewerOwnerId = session.ownerId
  //
  // ...and delete the query-param block below.
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const viewerOwnerId = url.searchParams.get('ownerId') || null
  // ---- END TESTING MODE BLOCK ----

  const listId = process.env.HUBSPOT_LIST_ID
  if (!listId) {
    console.error('api/data: HUBSPOT_LIST_ID is not set')
    res.status(500).json({ error: 'Server is not configured' })
    return
  }

  try {
    const [owners, contactIds] = await Promise.all([getAllOwners(), getListContactIds(listId)])

    const contacts = await batchReadContacts(contactIds, CONTACT_PROPS)
    const primaryDealIds = await getPrimaryDealIdsForContacts(contactIds)

    const dealIds = [...new Set([...primaryDealIds.values()].filter(Boolean))]
    const deals = await batchReadDeals(dealIds, DEAL_PROPS)
    const dealsById = new Map(deals.map((d) => [d.id, d]))

    const records = contacts.map((c) => {
      const p = c.properties || {}
      const dealId = primaryDealIds.get(c.id) || null
      const deal = dealId ? dealsById.get(dealId) : null
      const dp = deal?.properties || {}

      const missingContactProps = TRACKED_CONTACT_PROPS.filter((key) => isBlank(p[key]))
      const contactOwnerId = p.hubspot_owner_id || null
      const dealOwnerId = deal ? (dp.hubspot_owner_id || null) : null

      return {
        contactId: c.id,
        name: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || `Contact ${c.id}`,
        email: p.email || null,
        contactOwnerId,
        contactOwnerName: ownerLabel(owners, contactOwnerId),
        missingContactProps,
        deal: deal
          ? {
              dealId: deal.id,
              name: dp.dealname || `Deal ${deal.id}`,
              stage: dp.dealstage || null,
              ownerId: dealOwnerId,
              ownerName: ownerLabel(owners, dealOwnerId),
              ownerMissing: isBlank(dealOwnerId),
            }
          : null,
      }
    })

    const mine = viewerOwnerId
      ? records.filter((r) => r.deal && r.deal.ownerId === viewerOwnerId)
      : []

    const unowned = records.filter((r) => {
      const contactOwnerMissing = isBlank(r.contactOwnerId)
      const noDeal = !r.deal
      const dealOwnerMissing = r.deal && r.deal.ownerMissing
      return contactOwnerMissing || noDeal || dealOwnerMissing
    }).map((r) => ({
      ...r,
      reasons: [
        isBlank(r.contactOwnerId) && 'Contact has no owner',
        !r.deal && 'No primary deal found',
        r.deal && r.deal.ownerMissing && 'Primary deal has no owner',
      ].filter(Boolean),
    }))

    // Grouped view: every contact with at least one missing property,
    // bucketed by the AE responsible for it (the primary deal's owner,
    // falling back to the contact's own owner if there's no deal). A
    // contact with neither is skipped here — it has no AE to group under
    // and already shows up in "unowned" above.
    const byAEMap = new Map()
    for (const r of records) {
      if (r.missingContactProps.length === 0) continue
      const ownerId = r.deal?.ownerId || r.contactOwnerId
      if (isBlank(ownerId)) continue
      const ownerName = (r.deal?.ownerId ? r.deal.ownerName : r.contactOwnerName) || `Owner ${ownerId}`
      if (!byAEMap.has(ownerId)) {
        byAEMap.set(ownerId, { ownerId, ownerName, records: [] })
      }
      byAEMap.get(ownerId).records.push(r)
    }
    const byAE = [...byAEMap.values()]
      .sort((a, b) => a.ownerName.localeCompare(b.ownerName))
      .map((g) => ({ ...g, records: g.records.sort((a, b) => a.name.localeCompare(b.name)) }))

    res.setHeader('Cache-Control', 'private, no-store')
    res.status(200).json({
      mine,
      unowned,
      byAE,
      meta: { listId, totalInList: contacts.length, fetchedAt: new Date().toISOString() },
    })
  } catch (err) {
    console.error('api/data failed:', err)
    res.status(502).json({ error: 'Failed to load data from HubSpot' })
  }
}
