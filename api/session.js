import { getSession } from './_auth.js'

export default async function handler(req, res) {
  const session = getSession(req)
  if (!session) {
    res.status(401).json({ error: 'Not signed in' })
    return
  }
  res.status(200).json({
    email: session.email,
    name: session.name,
    picture: session.picture,
    ownerId: session.ownerId,
    ownerMatched: session.ownerId !== null,
  })
}
