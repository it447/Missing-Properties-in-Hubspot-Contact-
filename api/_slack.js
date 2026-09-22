// Thin wrapper around the Slack Web API. Requires SLACK_BOT_TOKEN
// (scopes: chat:write, users:read.email) — server-side only, same
// pattern as HUBSPOT_TOKEN in _hubspot.js.
const SLACK_BASE = 'https://slack.com/api'

async function slackFetch(method, params = {}) {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) throw new Error('Missing SLACK_BOT_TOKEN env var')
  // Form-encoded, not JSON — some Slack Web API methods (users.lookupByEmail
  // among them) reject a JSON body with "invalid_arguments" even though the
  // params are correct. Form-encoding is the one format every method
  // reliably accepts.
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.append(key, String(value))
  }
  const res = await fetch(`${SLACK_BASE}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const data = await res.json()
  // Slack's API always returns HTTP 200 — success/failure is in the body.
  if (!data.ok) {
    const err = new Error(`Slack ${method} failed: ${data.error}`)
    err.slackError = data.error
    throw err
  }
  return data
}

// Resolves a HubSpot owner's email to their Slack user ID. Returns null
// (and logs a warning) rather than throwing when no Slack account matches
// that email — a mismatch shouldn't take down the whole reminder run, it
// just means that one message goes out without a working @mention.
export async function lookupSlackUserIdByEmail(email) {
  if (!email) return null
  try {
    const data = await slackFetch('users.lookupByEmail', { email })
    return data.user?.id || null
  } catch (err) {
    if (err.slackError === 'users_not_found') {
      console.warn(`Slack: no user found for email ${email}`)
      return null
    }
    throw err
  }
}

// channel accepts either a channel ID (e.g. "C0123456", preferred — see
// README for how to find one) or a public channel name ("general") that
// the bot has been invited to.
export async function postSlackMessage(channel, text) {
  await slackFetch('chat.postMessage', { channel, text })
}
