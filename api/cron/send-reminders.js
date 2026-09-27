// Slack reminder job, Monday-Friday only, spaced across three time slots
// instead of firing all at once:
//   9:00am ET  -> reminder 1
//   9:30am ET  -> reminder 2
//   10:00am ET -> reminder 3 (final, escalates to Dijah + Elena)
// The "Unowned" deal-has-no-owner alert to Elena rides the 9:00am slot.
//
// Scheduled via vercel.json's `crons` at every UTC time that could
// correspond to one of these three ET slots under EDT or EST (Vercel Cron
// has no timezone/DST awareness). Some entries only do real work for half
// the year and no-op the other half — see reminderTierForNow() below,
// which is what actually decides whether/what to send on each invocation,
// self-correcting across DST with no manual maintenance.
//
// Query params (for manual testing, e.g. ?force=true&tier=1&limit=1):
//   force=true  bypasses the weekday + time-slot gate
//   tier=1|2|3  which reminder tier to run when forced (default 1)
//   limit=N     caps this run to at most N AE reminders and N unowned
//               alerts (not N total), so a test doesn't message every
//               contact at once. Omit for unlimited (the real run).
import { getMissingPropertiesData } from '../_missingProperties.js'
import { lookupSlackUserIdByEmail, postSlackMessage } from '../_slack.js'
import {
  getReminderState,
  shouldSendReminderToday,
  recordReminderSent,
  reminderKey,
  listReminderKeys,
  clearReminderByKey,
} from '../_reminders.js'
import { buildReminderMessage, buildUnownedDealMessage } from '../_slackTemplates.js'

const ESCALATION_EMAILS = ['dijah@scalearmy.com', 'elena@scalearmy.com']
const ELENA_EMAIL = 'elena@scalearmy.com'
const MAX_REMINDERS = 3

// Minutes-since-midnight for each reminder tier's Eastern time slot, and
// how many minutes of drift either side still counts as "that slot" (a
// cron invocation can fire a few minutes late).
const TIER_SLOTS = { 1: 9 * 60, 2: 9 * 60 + 30, 3: 10 * 60 }
const SLOT_TOLERANCE_MINUTES = 10

function getEasternNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  )
  return { weekday: parts.weekday, hour: Number(parts.hour), minute: Number(parts.minute) }
}

function isWeekday({ weekday }) {
  return weekday !== 'Sat' && weekday !== 'Sun'
}

// Returns 1, 2, or 3 if the current Eastern time falls within that tier's
// slot (+/- tolerance), else null — meaning this invocation has nothing
// to do (it's one of the "other season" UTC firings, or just off-schedule).
function reminderTierForNow({ hour, minute }) {
  const nowMinutes = hour * 60 + minute
  for (const [tier, slotMinutes] of Object.entries(TIER_SLOTS)) {
    if (Math.abs(nowMinutes - slotMinutes) <= SLOT_TOLERANCE_MINUTES) return Number(tier)
  }
  return null
}

export default async function handler(req, res) {
  // Vercel automatically sends this header (when CRON_SECRET is set on the
  // project) on invocations it triggers itself — set CRON_SECRET in Vercel
  // env vars so this endpoint can't be triggered by anyone who finds the URL.
  if (process.env.CRON_SECRET) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
  }

  const params = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams
  const force = params.get('force') === 'true'

  let tier
  if (force) {
    tier = params.get('tier') ? Number(params.get('tier')) : 1
  } else {
    const easternNow = getEasternNow()
    if (!isWeekday(easternNow)) {
      res.status(200).json({ skipped: true, reason: 'Weekend' })
      return
    }
    tier = reminderTierForNow(easternNow)
    if (!tier) {
      res.status(200).json({ skipped: true, reason: 'Not a reminder time slot' })
      return
    }
  }

  // Caps how many AE reminders and how many unowned-deal alerts get sent
  // this run — for manually testing against real Slack/HubSpot data
  // without messaging every contact at once. Ignored (unlimited) unless
  // explicitly passed.
  const limitParam = params.get('limit')
  const limit = limitParam ? Number(limitParam) : Infinity

  const listId = process.env.HUBSPOT_LIST_ID
  const channel = process.env.SLACK_CHANNEL
  if (!listId || !channel) {
    console.error('cron/send-reminders: HUBSPOT_LIST_ID and/or SLACK_CHANNEL not set')
    res.status(500).json({ error: 'Server is not configured' })
    return
  }

  const slackIdCache = new Map()
  async function resolveSlackId(email) {
    if (!email) return null
    if (slackIdCache.has(email)) return slackIdCache.get(email)
    const id = await lookupSlackUserIdByEmail(email)
    slackIdCache.set(email, id)
    return id
  }

  const summary = { tier, aeReminders: 0, unownedAlerts: 0, cleared: 0, errors: 0 }

  try {
    const { byAE, unowned, owners } = await getMissingPropertiesData({ listId })
    const emailByOwnerId = new Map(owners.map((o) => [String(o.id), o.email]))

    const activeKeys = new Set()

    for (const group of byAE) {
      let aeSlackId
      for (const record of group.records) {
        const dealId = record.deal?.dealId || null
        activeKeys.add(reminderKey(record.contactId, dealId))

        if (summary.aeReminders >= limit) continue

        const state = await getReminderState(record.contactId, dealId)
        if (state.count >= MAX_REMINDERS) continue

        const reminderNumber = state.count + 1
        // This tier's slot only sends reminders whose number matches it —
        // that's what actually spaces 1/2/3 across the day instead of a
        // contact getting all applicable reminders in one run.
        if (reminderNumber !== tier) continue
        if (!shouldSendReminderToday(state)) continue

        if (aeSlackId === undefined) aeSlackId = await resolveSlackId(emailByOwnerId.get(String(group.ownerId)))

        let escalationSlackIds = []
        if (reminderNumber === MAX_REMINDERS) {
          escalationSlackIds = (await Promise.all(ESCALATION_EMAILS.map(resolveSlackId))).filter(Boolean)
        }

        const message = buildReminderMessage({
          reminderNumber,
          aeSlackId,
          escalationSlackIds,
          contactName: record.name,
          contactUrl: record.hubspotUrl,
          dealName: record.deal?.name || null,
          dealUrl: record.deal?.hubspotUrl || null,
          missingContactProps: record.missingContactProps,
        })

        try {
          await postSlackMessage(channel, message)
          await recordReminderSent(record.contactId, dealId, reminderNumber)
          summary.aeReminders += 1
        } catch (err) {
          console.error(`Failed to send reminder for contact ${record.contactId}:`, err)
          summary.errors += 1
        }
      }
    }

    // The Unowned deal-has-no-owner alert has no tiers — it's a single
    // flat daily message, so it only rides the first (9am) slot.
    if (tier === 1) {
      const elenaSlackId = await resolveSlackId(ELENA_EMAIL)
      for (const record of unowned) {
        if (!record.deal || !record.deal.ownerMissing) continue
        if (summary.unownedAlerts >= limit) continue
        const message = buildUnownedDealMessage({
          elenaSlackId,
          contactName: record.name,
          contactUrl: record.hubspotUrl,
          dealName: record.deal.name,
          dealUrl: record.deal.hubspotUrl,
        })
        try {
          await postSlackMessage(channel, message)
          summary.unownedAlerts += 1
        } catch (err) {
          console.error(`Failed to send unowned-deal alert for contact ${record.contactId}:`, err)
          summary.errors += 1
        }
      }
    }

    // Clear reminder state for any contact+deal that no longer appears in
    // the live "By AE" list (resolved, or its deal moved to an excluded
    // stage) — otherwise it'd never get cleared, since the loop above only
    // visits what's currently missing.
    const allKeys = await listReminderKeys()
    for (const key of allKeys) {
      if (!activeKeys.has(key)) {
        await clearReminderByKey(key)
        summary.cleared += 1
      }
    }

    res.status(200).json({ ok: true, ...summary })
  } catch (err) {
    console.error('cron/send-reminders failed:', err)
    // Included in the response (not just server logs) to make manual
    // testing faster — this endpoint requires CRON_SECRET once that's
    // set, so it's not exposing internals to the public.
    res.status(502).json({ error: 'Failed to run reminder job', detail: err.message, slackError: err.slackError })
  }
}
