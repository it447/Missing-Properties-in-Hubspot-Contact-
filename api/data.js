// Vercel serverless function — HTTP endpoint wrapping the shared
// computation in api/_missingProperties.js. See that file for the actual
// fetch/split/group logic (also used by api/cron/send-reminders.js).
// TESTING MODE: getSession/login is bypassed below (see the block marked
// "RE-ENABLE LOGIN HERE"). "Mine" is instead driven by an ?ownerId=
// query param so you can test the My List / Unowned split by picking any
// AE from the dropdown, without Google OAuth set up yet.
import { getSession } from './_auth.js' // eslint-disable-line no-unused-vars -- kept for the re-enable step below
import { getMissingPropertiesData } from './_missingProperties.js'

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
    const { mine, unowned, byAE, meta } = await getMissingPropertiesData({ listId, viewerOwnerId })
    res.setHeader('Cache-Control', 'private, no-store')
    res.status(200).json({ mine, unowned, byAE, meta })
  } catch (err) {
    console.error('api/data failed:', err)
    res.status(502).json({ error: 'Failed to load data from HubSpot' })
  }
}
