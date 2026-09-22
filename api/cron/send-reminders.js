// Daily Slack reminder job. Scheduled via vercel.json's `crons` at both
// 13:00 and 14:00 UTC (covering 9am Eastern under both EDT and EST —
// Vercel Cron has no timezone/DST awareness, so instead of picking one
// UTC time and letting it drift an hour twice a year, this runs twice a
// day and the check below only actually does anything on the invocation
// where it's really 9am America/New_York. Self-correcting, no maintenance.
//
// Each still-missing contact+deal gets reminder 1/2/3 (tracked in Redis,
// see _reminders.js) via the "By AE" flow, tagging the AE (plus Dijah and
// Elena on reminder 3). Separately, every "Unowned" contact whose primary
// deal specifically has no owner gets a flat daily alert tagging Elena
// (see _slackTemplates.js's buildUnownedDealMessage — this one has no
// escalation tiers).
//
// Query params (for manual testing, e.g. ?force=true&limit=1):
//   force=true  bypasses the 9am-Eastern gate so it runs immediately
//   limit=N     caps this run to at most N AE reminders and N unowned
//               alerts (not N total), so a test doesn't message every
//               contact at once. Omit for unlimited (the real daily run).
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

function isNineAmEastern() {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).format(new Date())
  return Number(hour) === 9
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
  if (!force && !isNineAmEastern()) {
    res.status(200).json({ skipped: true, reason: 'Not 9am America/New_York' })
    return
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

  const summary = { aeReminders: 0, unownedAlerts: 0, cleared: 0, errors: 0 }

  try {
    const { byAE, unowned, owners } = await getMissingPropertiesData({ listId })
    const emailByOwnerId = new Map(owners.map((o) => [String(o.id), o.email]))
    const escalationSlackIds = (await Promise.all(ESCALATION_EMAILS.map(resolveSlackId))).filter(Boolean)
    const elenaSlackId = await resolveSlackId(ELENA_EMAIL)

    const activeKeys = new Set()

    for (const group of byAE) {
      const aeSlackId = await resolveSlackId(emailByOwnerId.get(String(group.ownerId)))
      for (const record of group.records) {
        const dealId = record.deal?.dealId || null
        activeKeys.add(reminderKey(record.contactId, dealId))

        if (summary.aeReminders >= limit) continue

        const state = await getReminderState(record.contactId, dealId)
        if (state.count >= MAX_REMINDERS) continue
        if (!shouldSendReminderToday(state)) continue

        const reminderNumber = state.count + 1
        const message = buildReminderMessage({
          reminderNumber,
          aeSlackId,
          escalationSlackIds: reminderNumber === MAX_REMINDERS ? escalationSlackIds : [],
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
