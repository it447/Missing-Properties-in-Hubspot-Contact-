// TESTING MODE helper — lets the frontend populate a "view as" dropdown of
// HubSpot owners so the My List / Unowned split can be exercised without
// Google login wired up yet. Not needed once real login is re-enabled
// (the AE's owner ID would come from their session instead), but harmless
// to leave in either way since it's read-only.
import { getAllOwners } from './_hubspot.js'

export default async function handler(req, res) {
  try {
    const owners = await getAllOwners()
    res.setHeader('Cache-Control', 'private, no-store')
    res.status(200).json({
      owners: owners
        .map((o) => ({
          id: String(o.id),
          name: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email,
          email: o.email,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch (err) {
    console.error('api/owners failed:', err)
    res.status(502).json({ error: 'Failed to load owners from HubSpot' })
  }
}
