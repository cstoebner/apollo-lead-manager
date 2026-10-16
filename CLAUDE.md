# Apollo Lead Manager — notes for an AI assistant

Read [README.md](README.md) first for what this is and how it is put together. This file is the part that isn't obvious
from the code: how the owner likes to work, and the traps that have already cost time.

## The owner and how to work with them

- The owner (Conor) runs Apollo Music Academy and is not a developer. Explain things in plain language, say what you
  changed and why it matters to them, and keep updates short. Don't ask them to read code.
- **Ask before pushing.** Commit locally, report, and push (`git push origin agent/initial-prototype`) only when told
  "push". The branch auto-deploys to production. After pushing, confirm the deployment actually finished before saying it's live.
- **Plan first for big features,** then wait for an OK. Small fixes can just be done.
- **Never ask them to paste secrets or API keys into chat.** They enter secrets themselves (Cloudflare dashboard,
  Apps Script Script Properties, hidden Terminal prompts, or the clipboard trick: generate with `openssl rand -hex 32 | pbcopy`).
  Share only non-secret output.
- **Give SQL in the chat message** (not just a file) so they can paste it into the Supabase SQL editor. Run migrations
  *before* pushing code that needs them. Also save each change as a numbered file in `supabase/migrations/`.
- Verify before saying something works: type-check (`npx tsc -b`), build, and test with fake data. Say plainly what you
  could not verify. Clean up any test leads afterward (names starting "Zz" were used for tests).
- Do not change the owner's DNS, Acuity settings, Stripe, or production data yourself; give exact steps instead.
- Their preferences so far: duplicate protection was low priority except for lead intake; no waitlist feature; they like
  things on Today to be interactive (for example, Upcoming outreach days expand and each lead is actionable).

## Traps (each of these has already happened)

- **The folder path contains a colon.** `wrangler` and Vite's dev server break on it. Do deploys and server dev from a copy
  at a path with no colon (e.g. under a temp directory), with `node_modules` available there.
- **Cloudflare variables only apply to a new deployment.** After a secret changes, push a deployment before testing.
- **Cloudflare caps each request at 50 outbound subrequests** (every Supabase or Acuity call counts). Anything that loops
  over several instructors or emails must be split into separate requests or capped (see `reconcile.ts`, `intake.ts`).
- **New Supabase tables need explicit grants,** and the browser needs an RLS `select` policy for `authenticated`.
  The server uses the service-role key, which also needs grants (migrations 011, 012, 018, 019).
- **Server-side inserts into `activities` must include `owner_id`** (use `functions/_shared/activities.ts`), because the
  service role has no signed-in user.
- **`activities.type` has a CHECK constraint;** adding a new activity type needs a migration (see 013, 014).
- **The app loads data once.** Things the server creates (leads, notes) reach the open browser through the 60-second
  refresh in `Workspace` (`loadChangesSince`, `loadIntakeData`).
- **Acuity quirks:** webhook actions are `scheduled|rescheduled|canceled|changed` (the UI strips an `appointment.`
  prefix); datetimes use offsets like `-0500`; bookable start times are built from each day's opening time in steps of
  the start-time interval (currently 15 minutes); minimum notice is 24 h and maximum 30 days, which the Day 0 email
  rules mirror; an appointment type must be assigned to a calendar for its booking link to work.
- **Blocking model:** reconciliation blocks everything except flagged trial openings and active holds, as continuous
  blocks. Opening a slot splits a block (`openWindow`); never delete a whole block to open one slot.
- **Email deliverability depends on DNS:** keep one SPF record (Google only), Google DKIM on, DMARC present.

## Where things live

App `src/App.tsx` (one large file) and `src/database.ts`; server `functions/`; cron Worker `cron-worker/`; migrations
`supabase/migrations/`; Gmail/Sheets script `apps-script/flag-app/` (pushed with `clasp`, which is logged in as the
owner's Apollo account on their machine; `.clasp.json` is git-ignored and not in the repo). Design docs: `docs/`.
