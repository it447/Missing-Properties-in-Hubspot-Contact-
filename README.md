# AE Missing Properties

Shows each Account Executive the contacts (from a HubSpot Active List)
where required properties are missing, scoped to deals they own — plus a
shared "Unowned" tab for contacts/deals that have fallen through the cracks
entirely.

Built with Vite + React. All HubSpot API calls happen server-side in Vercel
serverless functions (`api/*.js`) — the private app token never reaches the
browser.

## Testing mode (login currently disabled)

Google Sign-In is switched off right now so you can try the app without
setting up OAuth first. Instead there's a **"Viewing as"** dropdown (built
from `/api/owners`) that lets you preview any AE's My List. Only the
HubSpot env vars are required in this mode — the Google/session vars in
`.env.example` can stay blank for now.

**To re-enable real login later:**
1. `src/App.withLogin.jsx.bak` has the original sign-in version of the
   frontend — restore it as `src/App.jsx` (merging in any changes made
   while in testing mode).
2. In `api/data.js`, swap the block marked `RE-ENABLE LOGIN HERE` back to
   the real session check (the commented-out code is right there).
3. `api/auth.js`, `api/session.js`, `api/logout.js`, and `api/_auth.js`
   were left untouched the whole time — nothing to change in them.
4. Fill in `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` / `ALLOWED_DOMAIN` /
   `AUTH_SECRET` in your `.env`, and uncomment the Google script tag in
   `index.html`.

## What it checks

For every contact currently in the configured Active List:

- **Missing properties** (contact-only, not deal properties): `mql`, `sql`,
  `sal`, `initial_meeting_outcome`.
- **Primary deal**: each contact's associated deal that's labeled "Primary"
  in HubSpot (see the note in `api/_hubspot.js` about how that's resolved —
  it's looked up dynamically from your portal's association labels, not
  hardcoded, since the numeric ID for that isn't the same across portals).

**"My List" tab** — contacts whose primary deal's owner matches the
logged-in AE (matched via their Google login email → HubSpot owner email).

**"Unowned" tab** — contacts where the contact itself has no owner, or
whose primary deal has no owner, or where no primary deal was found at all.
This tab is shared/global, not scoped per-AE, since there's no owner to
scope by.

## Setup

1. Copy `.env.example` to `.env` and fill in:
   - A HubSpot private app token (scopes listed in `.env.example`).
   - Your Active List's numeric ID.
   - A Google OAuth Client ID (Web application type).
   - A random `AUTH_SECRET`.
2. Install dependencies:

```bash
npm install
```

## Run locally

Two terminals, same pattern as the reconciliation dashboard:

```bash
npm run dev:api   # terminal 1 -- runs api/*.js under plain Node, reads .env
npm run dev       # terminal 2 -- Vite dev server, proxies /api to the above
```

Open the printed localhost URL. Add that exact URL to the Google OAuth
client's "Authorized JavaScript origins" or the sign-in button won't work.

## Deploy on Vercel

1. Push this folder to its own GitHub repo.
2. Vercel → Add New… → Project → import the repo. Defaults are fine (Vite
   auto-detected, `api/*.js` auto-detected as serverless functions).
3. Project Settings → Environment Variables → add everything from
   `.env.example` (real values).
4. Add the deployed URL (e.g. `https://your-app.vercel.app`) to the Google
   OAuth client's "Authorized JavaScript origins".
5. Deploy.

## Things worth knowing

- **Primary-deal lookup is dynamic, not hardcoded.** HubSpot's contact↔deal
  "Primary" association type ID isn't the same across portals, so
  `api/_hubspot.js` asks HubSpot's own Associations Schema API which type
  is labeled "Primary" and uses that. If your portal labels it something
  other than "Primary", check the console warning that fires when no match
  is found, and adjust the `PRIMARY_LABEL_RE` regex at the top of that
  file.
- **A contact with no owner still needs a HubSpot owner match to show up in
  "My List"** — if an AE signs in with a Google account whose email doesn't
  match any HubSpot owner's email exactly, they'll see a banner saying so,
  and "My List" will be empty (they'll still see "Unowned").
- **No write access at all.** Every HubSpot scope requested is read-only —
  this tool only surfaces gaps, it doesn't fix them.
- **Session cookie**, not HubSpot OAuth per user — a signed, HttpOnly
  cookie (12-hour expiry) carries the AE's email/name/resolved owner ID
  after Google verifies their identity. `AUTH_SECRET` signs it; keep that
  secret in Vercel's env vars, never in the repo.
