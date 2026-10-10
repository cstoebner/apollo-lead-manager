# Automatic lead intake + Day 0 email

New leads from **Meta** (rows in a Google Sheet) and **Formspree** (emails) are sent to Apollo, which creates the
lead, checks for duplicates, picks the first two flagged trial openings, and queues a Day 0 email that a Google
Apps Script sends from Conor's Gmail.

## Flow
1. **Apps Script** (project "Flag App", bound to the "Apollo Music Academy - Lead Ads" sheet; source in
   [apps-script/flag-app/](../apps-script/flag-app/)):
   - `apollo-intake.js` posts each new sheet row / Formspree email to `POST /api/inbound/lead`, and every minute
     pulls approved emails from `POST /api/inbound/outbox`, sends them with `GmailApp`, and reports back.
   - `apollo-lead-email-alert.js` (the older "you got a lead" alert email) is unchanged except for one guarded call
     to `apolloOnSheetChange()` at the end of `onLeadChange`.
2. **Server** ([functions/api/inbound/](../functions/api/inbound/), logic in
   [functions/_shared/intake.ts](../functions/_shared/intake.ts)):
   - `lead.ts` (secret header) — normalize → duplicate check → create lead + queue email.
   - `outbox.ts` (secret header) — `pull` / `sent` / `failed` for the script.
   - `resolve.ts` (signed-in) — answers the "Is this the same lead?" card (`same` | `different` | `dismiss`).
   - `email.ts` (signed-in) — approve or discard a draft email, retry a failed one.
3. **App** — Today page cards: "Possible duplicate leads", "Submissions that couldn't be read", "Day 0 emails"
   (drafts/failures); Settings → "Automatic lead emails" toggle (`app_settings.intake_auto_send`).

## Rules
- **Duplicates:** same email or same phone (last 10 digits) as an existing lead → no lead, no email, a card asks
  "same lead?". Yes = note added to the original; No = new lead + email.
- **Times offered:** first two flagged trial openings, ≥ 24 h away (within 45 days), for an instrument the lead
  asked for, with an Acuity-linked instructor and an `acuity_appointment_types` row; skipping openings taken by a
  lesson/break/vacation (recurrence ported in `functions/_shared/chicago.ts`) or an active/confirmed hold.
  Fewer than two → the "no openings" template (booking link only). The Book now link is
  `https://apollo-music-academy-booking.as.me/?appointmentType=<id>` (pre-filled with the lead's details).
- **Draft mode:** `intake_auto_send` defaults to false — every email waits for approval on the Today page.
- **Idempotency:** `inbound_leads.external_id` is unique (Meta lead id / Gmail message id); retries are harmless.
- **Cadence:** a sent email is logged as an `email` activity and does not advance the call/text cadence.
- The Day 0 text/call still happen manually.

## Setup (one time)
1. Run `supabase/migrations/018_lead_intake.sql` in the Supabase SQL editor.
2. Cloudflare Pages → Variables and Secrets: add `INTAKE_SECRET` (a long random value). Redeploy.
3. Apps Script → Project Settings → Script Properties: `APOLLO_INTAKE_SECRET` = the same value.
4. Push the script files (`clasp push`, or paste), run `setupApolloTriggers` once and approve the permissions.
5. Run `testFormspreeParse` to confirm the Formspree reader finds the fields.

## Templates
Editable in Settings → Message templates → "Automatic Day 0 email (new leads)": `intake_day0_email_subject`,
`intake_day0_email`, `intake_day0_email_no_times`. Variables: `firstName`, `instrument`, `time1`, `time2`, `bookingLink`.
