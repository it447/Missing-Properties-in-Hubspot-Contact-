// Session helper for the Google-login gate. Unlike the reconciliation
// dashboard's single-shared-password cookie (which only needed to prove
// "yes/no, and not expired"), this cookie has to carry WHO is logged in —
// their email, display name, and resolved HubSpot owner ID — so api/data.js
// knows whose deals count as "theirs" without hitting HubSpot's Owners API
// on every request. The payload is signed (HMAC-SHA256) so the browser
// can't forge or edit it, and it's HttpOnly so client JS can't read it
// either; AUTH_SECRET never reaches the browser.
import crypto from 'crypto'

const COOKIE_NAME = 'ae_session'
const SESSION_MS = 12 * 60 * 60 * 1000 // 12 hours

function b64urlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64url')
}
function b64urlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8')
}

function sign(value) {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('Missing AUTH_SECRET env var')
  return crypto.createHmac('sha256', secret).update(value).digest('hex')
}

// payload: plain object, e.g. { email, name, picture, ownerId }
export function issueToken(payload) {
  const body = { ...payload, exp: Date.now() + SESSION_MS }
  const encoded = b64urlEncode(JSON.stringify(body))
  return `${encoded}.${sign(encoded)}`
}

export function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

// Returns the decoded session payload, or null if missing/invalid/expired.
export function getSession(req) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
    if (!token) return null
    const [encoded, sig] = token.split('.')
    if (!encoded || !sig) return null
    const expected = sign(encoded)
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    const payload = JSON.parse(b64urlDecode(encoded))
    if (!payload.exp || Number(payload.exp) <= Date.now()) return null
    return payload
  } catch (_) {
    return null
  }
}

export function isAuthorized(req) {
  return getSession(req) !== null
}

export function setSessionCookie(res, payload) {
  const token = issueToken(payload)
  const secure = process.env.VERCEL ? '; Secure' : ''
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}; SameSite=Lax${secure}`
  )
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`)
}
