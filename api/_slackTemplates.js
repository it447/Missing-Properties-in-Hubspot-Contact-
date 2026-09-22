// Slack message templates for the missing-properties reminder flow.
// Pure string-building — no Slack API calls here. That's deliberate: the
// webhook/cron piece that actually posts these (and tracks which reminder
// number a contact+deal is on) hasn't been wired up yet. This module is
// the templates alone, ready to plug into that once it exists.

// Same tracked-property set as api/data.js / src/App.jsx — kept in sync
// manually since it's a fixed, confirmed-scope list, not something either
// side reads from the other at runtime.
const PROP_LABELS = {
  mql: 'MQL',
  sql: 'SQL',
  sal: 'SAL',
  initial_meeting_outcome: 'Initial Meeting Outcome',
}

function formatMissingProperties(missingContactProps) {
  return missingContactProps.map((key) => PROP_LABELS[key] || key).join(', ')
}

// contactUrl / dealUrl may be null (no HUBSPOT_PORTAL_ID configured, or no
// primary deal found) — the template still renders, just without a link.
function formatLink(url, label) {
  return url ? `<${url}|${label}>` : label
}

const REMINDER_COPY = {
  1: {
    emoji: ':warning:',
    title: 'Missing Property Alert',
    intro: (mentions) => `Hey ${mentions} — this contact is missing required info and needs your attention.`,
    closing: 'Please update these fields in HubSpot when you get a chance.',
  },
  2: {
    emoji: ':warning:',
    title: 'Missing Property Reminder — 2nd notice',
    intro: (mentions) => `Hey ${mentions} — this is a reminder that the following record still has missing properties.`,
    closing: 'This is your second reminder — please update this record.',
  },
  3: {
    emoji: ':rotating_light:',
    title: 'Missing Property Escalation — Final Notice',
    intro: (mentions) => `Hey ${mentions} — escalating this one.`,
    closing: 'This is the third and final reminder — please update this data record.',
  },
}

// Builds the Slack mrkdwn text for one reminder. `reminderNumber` is
// 1, 2, or 3 (3 = final/escalation, tags escalationSlackIds in addition to
// the AE). Slack IDs are passed in already resolved (e.g. by matching a
// HubSpot owner's email against Slack's users.list) — this module doesn't
// do that lookup itself.
export function buildReminderMessage({
  reminderNumber,
  aeSlackId,
  escalationSlackIds = [],
  contactName,
  contactUrl,
  dealName,
  dealUrl,
  missingContactProps,
}) {
  const copy = REMINDER_COPY[reminderNumber]
  if (!copy) throw new Error(`Invalid reminderNumber: ${reminderNumber} (expected 1, 2, or 3)`)

  const mentionIds = reminderNumber === 3 ? [aeSlackId, ...escalationSlackIds] : [aeSlackId]
  const mentions = mentionIds.filter(Boolean).map((id) => `<@${id}>`).join(', ')

  const contactLine = `*Contact:* ${formatLink(contactUrl, contactName)}`
  const dealLine = dealName ? `*Deal:* ${formatLink(dealUrl, dealName)}` : '*Deal:* No primary deal found'
  const missingLine = `*Missing:* ${formatMissingProperties(missingContactProps)}`

  return [
    `${copy.emoji} *${copy.title}*`,
    copy.intro(mentions),
    '',
    contactLine,
    dealLine,
    missingLine,
    '',
    copy.closing,
    '',
    `Contact URL: ${contactUrl || 'N/A'}`,
    `Deal URL: ${dealUrl || 'N/A'}`,
  ].join('\n')
}
