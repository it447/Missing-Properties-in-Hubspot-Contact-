// Tracks how many Slack reminders a contact+deal pair has received, so a
// daily job can know whether today's message should be the 1st, 2nd, or
// 3rd/final (escalation) reminder — and skip contacts it already reminded
// today, in case the job runs more than once.
//
// Backed by the Upstash Redis instance connected to this Vercel project
// (Storage tab). Uses the KV_REST_API_URL / KV_REST_API_TOKEN env vars
// Vercel injects for it — @upstash/redis is the current recommended
// client (the older @vercel/kv package is deprecated in favor of it).
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// Reminders reset after this many days of inactivity (e.g. the contact
// stopped appearing in the missing-properties list without us ever
// explicitly clearing it) so stale keys don't accumulate forever.
const TTL_SECONDS = 60 * 60 * 24 * 14

export function reminderKey(contactId, dealId) {
  return `reminder:${contactId}:${dealId || 'none'}`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// Returns { count, lastSentDate } — count is 0 and lastSentDate is null
// for a contact+deal that's never been reminded.
export async function getReminderState(contactId, dealId) {
  const state = await redis.get(reminderKey(contactId, dealId))
  return state || { count: 0, lastSentDate: null }
}

// True once per calendar day per contact+deal — guards against sending a
// second reminder if the daily job happens to run twice.
export function shouldSendReminderToday(state) {
  return state.lastSentDate !== today()
}

// Records that reminder number `reminderNumber` (1, 2, or 3) went out
// today for this contact+deal.
export async function recordReminderSent(contactId, dealId, reminderNumber) {
  await redis.set(
    reminderKey(contactId, dealId),
    { count: reminderNumber, lastSentDate: today() },
    { ex: TTL_SECONDS }
  )
}

// Called once a contact's missing properties are resolved, so if the same
// contact+deal goes missing again later it starts back at reminder 1
// instead of picking up where the old streak left off.
export async function clearReminderState(contactId, dealId) {
  await redis.del(reminderKey(contactId, dealId))
}

// Every reminder key currently stored. Used by the daily job to find and
// clear out contact+deal pairs that no longer appear in the live
// missing-properties list (resolved, or the deal moved to an excluded
// stage) — those otherwise wouldn't be visited again to get cleared, since
// the job only iterates over what's *currently* missing.
export async function listReminderKeys() {
  return await redis.keys('reminder:*')
}

export async function clearReminderByKey(key) {
  await redis.del(key)
}
