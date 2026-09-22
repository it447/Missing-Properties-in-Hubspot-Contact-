// Verifies the Google ID token sent from the Sign-In-With-Google button,
// enforces the workspace-domain restriction SERVER-SIDE (never trust a
// client-side check alone — a modified frontend could send any email), and
// resolves the AE's HubSpot owner ID by matching their Google email against
// HubSpot's Owners list.
import { OAuth2Client } from 'google-auth-library'
import { setSessionCookie } from './_auth.js'
import { getAllOwners, findOwnerByEmail } from './_hubspot.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const allowedDomain = process.env.ALLOWED_DOMAIN || 'scalearmy.com'
  if (!clientId) {
    console.error('api/auth: GOOGLE_CLIENT_ID is not set')
    res.status(500).json({ error: 'Server is not configured' })
    return
  }

  const credential = req.body && req.body.credential
  if (!credential) {
    res.status(400).json({ error: 'Missing credential' })
    return
  }

  try {
    const client = new OAuth2Client(clientId)
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId })
    const payload = ticket.getPayload()

    if (!payload || !payload.email_verified) {
      res.status(401).json({ error: 'Email not verified' })
      return
    }

    // hd is the Google Workspace domain claim — present for Workspace
    // accounts. Belt-and-suspenders: also check the email suffix in case hd
    // is ever absent for a domain that should still be allowed.
    const emailDomain = String(payload.email || '').split('@')[1]?.toLowerCase()
    if (payload.hd !== allowedDomain && emailDomain !== allowedDomain) {
      res.status(403).json({ error: `Only @${allowedDomain} accounts can sign in` })
      return
    }

    // Resolve HubSpot owner ID. A missing match isn't fatal — the AE can
    // still sign in and see the "Unowned" tab — but "My List" will be empty,
    // so we tell the client explicitly rather than let it look broken.
    let ownerId = null
    try {
      const owners = await getAllOwners()
      const owner = findOwnerByEmail(owners, payload.email)
      ownerId = owner ? String(owner.id) : null
    } catch (err) {
      console.error('api/auth: failed to resolve HubSpot owner:', err)
    }

    const session = {
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || null,
      ownerId,
    }
    setSessionCookie(res, session)
    res.status(200).json({ ok: true, ...session, ownerMatched: ownerId !== null })
  } catch (err) {
    console.error('api/auth: token verification failed:', err)
    res.status(401).json({ error: 'Invalid Google credential' })
  }
}
