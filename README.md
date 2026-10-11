# Apollo Lead Manager

A private lead tracker, follow-up planner, instructor scheduler and booking hub for Apollo Music Academy (Chaska, MN).
One person (the owner) uses it every day. It is a React + Vite + TypeScript single-page app on Supabase, with
Cloudflare Pages Functions for the server-side parts.

## What it does

- **Follow-up plan (Today).** Prioritized queue for new leads (Day 0/2/5/8 outreach) and nurture check-ins, aware of
  weekends, U.S. holidays and availability windows. Logs calls, texts, emails, notes and replies.
- **Trial workflow.** Hold a slot, text the Acuity booking link, confirm bookings as they arrive, track form completion,
  attendance and enrollment.
- **Instructor schedule.** Weekly grid with availability, recurring and one-time lessons, breaks, vacation, and flagged
  *trial openings* (the only times the public can book).
- **Acuity Scheduling integration.** Every Acuity calendar is blocked except flagged trial openings and active holds;
  bookings arrive by webhook as cards you confirm. See [docs/acuity-integration-plan.md](docs/acuity-integration-plan.md).
- **Automatic lead intake + Day 0 email.** New Meta and website-form leads are created automatically, checked for
  duplicates, and emailed two bookable trial times. See [docs/lead-intake-plan.md](docs/lead-intake-plan.md).
- **Message templates** for every text and email, editable in Settings.
- Leads who did not opt in to texts stay in the initial outreach but are kept out of the nurture campaign.
- Demo mode (no Supabase configured) shows fictional leads only.

Not built yet: the late-cancel / no-show $40 fee screen (the Stripe server routes exist), and a check for a new recurring
lesson landing on a booked trial.

## How it is put together

| Piece | Where | Notes |
|---|---|---|
| App (browser) | [src/](src/) | Almost everything is in `src/App.tsx`. Data access is in `src/database.ts`; cadence rules in `src/cadence.ts`. |
| Server routes | [functions/](functions/) | Cloudflare Pages Functions. App-facing routes require a signed-in user; cron routes require `X-Cron-Secret`; `/api/inbound/lead` and `/api/inbound/outbox` require `X-Intake-Secret`; webhooks verify signatures. Shared code in `functions/_shared/`. |
| Cron Worker | [cron-worker/](cron-worker/) | Separate Cloudflare Worker (Pages has no scheduler): hold expiry every 10 minutes, Acuity reconciliation nightly (one instructor per request, because of Cloudflare's per-request subrequest cap). |
| Database | [supabase/migrations/](supabase/migrations/) | Plain SQL, run by hand in the Supabase SQL editor, in order. New tables need explicit grants (see 011, 012, 018, 019). |
| Gmail / Sheets script | [apps-script/flag-app/](apps-script/flag-app/) | Google Apps Script project "Flag App", bound to the Meta lead-ads sheet. Sends new leads to Apollo and sends the emails Apollo queues. Edited with `clasp`. |
| Setup helpers | [scripts/](scripts/) | One-time Acuity helpers (list calendars/types, register webhooks). |

Hosting: Cloudflare Pages (production branch `agent/initial-prototype`, auto-deploys on push), Supabase (Postgres + auth),
Cloudflare Worker for cron, Google Workspace for email. Acuity Scheduling and Stripe are external services.

## Configuration

Nothing secret is stored in this repository. Set these where noted; never commit values.

**Browser app** (`.env.local` for local work, Pages build variables for production):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (the publishable key only, never the service-role key).

**Pages Functions** (Cloudflare Pages → Settings → Variables and Secrets; `.dev.vars` for local):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ACUITY_USER_ID`, `ACUITY_API_KEY`, `ACUITY_SCHEDULER_ID`, `ACUITY_MODE`
(`live` or `mock`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MODE`, `CRON_SECRET`, `INTAKE_SECRET`.
Without Acuity or Stripe keys the server falls back to in-memory mocks. Changed variables only take effect on the next deployment.

**Cron Worker:** secret `CRON_SECRET` (same value as Pages).
**Apps Script:** script property `APOLLO_INTAKE_SECRET` (same value as Pages' `INTAKE_SECRET`).

## Run locally

```bash
npm install
npm run dev        # demo mode unless VITE_SUPABASE_* are set
npm run build      # type-check and build
```

Gotcha: this project's folder path contains a colon, which breaks `wrangler` and Vite's dev server file access. For
deploys or server-side dev, work from a copy at a path with no colon.

## Deploy and operate

- **App + functions:** push to `agent/initial-prototype`; Cloudflare Pages builds and deploys.
- **Database changes:** run the new file from `supabase/migrations/` in the Supabase SQL editor *before* pushing code that needs it.
- **Cron Worker:** `wrangler deploy --config cron-worker/wrangler.toml` (secrets are kept across deploys).
- **Gmail/Sheets script:** `clasp push` from a folder containing the files in `apps-script/flag-app/` plus a `.clasp.json`
  (git-ignored). After pushing, new permissions must be approved by the account owner in the Apps Script editor.
- **Acuity looks wrong?** Settings → Acuity sync → *Sync Acuity now* re-blocks every calendar; *Check a slot* explains why a
  specific time is or isn't bookable. Useful Acuity settings: minimum notice 24 h, maximum 30 days, start-time interval 15 minutes.
- **Stop automatic emails:** Settings → Automatic lead emails → switch off (new emails then wait for approval).
- **Rotating a secret:** set the new value in every place listed under Configuration, then redeploy Pages.

## Email deliverability

Day 0 emails are sent from the owner's Google Workspace address. The domain should keep exactly one SPF record
(`v=spf1 include:_spf.google.com ~all`), Google DKIM authenticating, and a DMARC record with a reporting address.

## Conventions

- Real-world event times are logged as the real event time, not when the app recorded it.
- Anything that talks to Acuity or Stripe goes through a server route, never directly from the browser.
- The owner enters API keys and secrets themselves (Cloudflare dashboard, Script Properties); they are never pasted into
  chat or committed.
