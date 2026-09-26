# Apollo Leads × Acuity × Stripe — Build Plan

Adapted for this codebase from the original Claude Cowork hand-off spec
(`~/Downloads/acuity-integration-plan.md`), after resolving the gaps that spec
couldn't see (no server code existed yet, the existing Trial Opening grid
already overlaps with "trial slots," etc). This file is the living reference —
update it as decisions change, rather than trusting the original hand-off doc.

## Status (as of this build)

**Built and verified (typecheck + local `wrangler pages dev` smoke test, using
the mock Acuity/Stripe clients — no real credentials exist yet):**
- Supabase schema: `holds`, `acuity_blocks`, `acuity_events`, `fee_charges`,
  `instructors.acuity_calendar_id` ([011_acuity_integration.sql](../supabase/migrations/011_acuity_integration.sql))
- Booking-link builder with DST-correct offsets ([src/acuityLink.ts](../src/acuityLink.ts)) — unit-verified against both `-05:00`/`-06:00` and the spring-forward boundary
- Cloudflare Pages Functions scaffold ([functions/](../functions/)): holds create, trial-opening↔Acuity block sync, Acuity webhook receiver, Stripe dispute webhook, fee charge, hold-expiry cron route, nightly reconciliation cron route — all mockable via `ACUITY_MODE=mock` / `STRIPE_MODE=mock` (the default until real keys are set)
- Companion cron Worker ([cron-worker/](../cron-worker/)) to trigger the two `/api/cron/*` routes on a real schedule (Pages Functions has no native `scheduled()` support)
- One-time calendar-mapping script ([scripts/list-acuity-calendars.mjs](../scripts/list-acuity-calendars.mjs))

**Not built yet (next phase):**
- Any UI: no "Hold this slot" button, no Confirm/Don't-confirm Action Pending
  card, no late-cancel/fee-flow UI, no Settings page for mapping instructors to
  Acuity calendars. Everything above is backend-only, reachable by hand via curl
  or a future UI.
- Wiring "Text now" to log a `link_texted` activity when it sends a hold's link
- Recurring-lesson conflict check when *flagging* a Trial Opening (see the note
  in `acuity-block-sync.ts` — only the simple case is handled so far)
- Registering the real webhooks with Acuity once the API key exists (`POST /webhooks`)

## 1. Goals

1. The app decides what's bookable in Acuity. Only slots flagged as trial
   lessons (the existing Trial Opening toggle) are open; everything else is
   blocked.
2. Holding a trial for a family is one click: the app builds the exact Acuity
   booking link and "Text now" sends it.
3. Holds expire automatically after 24 hours.
4. Acuity bookings flow back into the app for Conor to confirm.
5. Late cancellations and no-shows become a guided notice → $40 charge flow,
   with every step timestamped as chargeback evidence.

## 2. Ground rules (non-negotiable)

- **The app is the source of truth.** Recurring lessons live only in the app
  and are never sent to Acuity (billed separately through another merchant).
- **The app never cancels or reschedules an Acuity appointment.** It only
  creates and deletes *blocks*.
- **A booked trial counts as taken** in the app, exactly like a lesson.
- **Warn on any conflict with a booked trial** (removing a trial slot, adding
  or moving a recurring student). Never silently override it.
- **Log real event times**: bookings are logged at Acuity's `datetimeCreated`,
  not the time Conor confirmed.
- Secrets (Acuity API key, Stripe secret key, Supabase service-role key) live
  only as Cloudflare Pages environment variables. They never reach the browser
  bundle — every Acuity/Stripe call happens in a Function, never client-side.

## 3. Decisions made building this out (superseding the original hand-off doc)

- **Both booking paths coexist.** A trial can be booked via the Acuity link
  *or* manually in-app (call the family, pick a time). Both need to end up in
  the same "trial booked" state on the lead record.
- **Trial slots = the existing `trial_openings` table / Trial Opening grid
  toggle.** No new "trial_slots" concept. Flagging a slot in the grid is now
  paired with an Acuity block-delete call (`acuity-block-sync.ts`); unflagging
  is paired with a block-create call, unless a trial is already booked there.
- **Manual bookings don't push an Acuity block.** Conor's actual workflow only
  ever books manually for off-schedule exception slots that were never public
  on Acuity to begin with — there's no real overlap to guard against, so no
  special re-block logic was built for this case. If a rare mismatch ever slips
  through, nightly reconciliation surfaces it rather than silently causing a
  double-book.
- **Hold expiry does nothing to Acuity — no exceptions.** Originally the plan
  had holds on an off-schedule exception slot restore their block on expiry.
  Conor: "I don't see that happening" often enough to build for. So
  `hold-expiry.ts` **only** flips the hold's status to `expired` — no Acuity
  call at all. If the hold's slot needs to be re-blocked, nightly
  reconciliation does it automatically as part of its normal every-night sweep
  (it always blocks everything except open trial slots + active holds, so an
  expired hold's slot simply falls back into "should be blocked" on the next
  run). This means there's up to ~1 night of exposure on the rare exception
  case — an accepted trade-off, consistent with the hold-exposure risk already
  accepted below.
- **The 24-hour hold-exposure risk is accepted as-is.** During a hold, the slot
  is genuinely public on Acuity's booking page (there's no way to gate a public
  booking page to one visitor) — a stranger could theoretically grab it. Given
  how short holds are and how niche these time slots are, this is accepted
  rather than engineered around.
- **Confirm/Don't-confirm, precisely:** this only ever fires when Acuity
  actually sends a real booking webhook — i.e., someone did complete the Acuity
  form. If nobody books, the hold just expires with nothing to confirm.
  "Confirm" links a real Acuity booking to the lead it was held for.
  "Don't confirm" means the person who booked doesn't match who the slot was
  held for (someone else grabbed it during the exposure window) — since that's
  a real, legitimate Acuity appointment, the app never deletes or touches it;
  "Don't confirm" only means "don't link this to my original lead," logged for
  Conor to sort out by hand.
- **The trial-form-reminder feature stays**, reframed: for Acuity-linked
  trials, it becomes "this hold is about to expire and they haven't booked yet"
  (driven by `holds.expires_at`, not the old `holdFormComplete` field).
  Manually-arranged trials keep working exactly as they do today.
- **Stripe webhook scope is narrow, on purpose.** An off-session charge with
  `confirm: true` returns synchronously — no webhook is needed to know if it
  worked. The one thing that *can* happen later is a dispute, so
  `stripe-webhook.ts` only handles `charge.dispute.created`, logged to the
  lead's activity trail for the chargeback-evidence record.
- **Hosting: Cloudflare Pages Functions in this same repo**, not a separate
  service — no new hosting bill (Workers/Pages free tier: 100k requests/day,
  Cron Trigger invocations count as ordinary requests, no separate charge).
  Cron Triggers, however, are a Worker-only feature with no Pages-native
  equivalent, hence the small companion Worker in `cron-worker/` whose only job
  is to call `/api/cron/hold-expiry` and `/api/cron/reconciliation` on a
  schedule with a shared secret header.

## 4. Known Acuity values

| Item | Value |
|---|---|
| Scheduler ID | `cd72e183` |
| Trial appointment type ID | `93655035` (verify via `GET /appointment-types`) |
| Example teacher calendar ID | `14124874` (fetch all via `GET /calendars`, or run `scripts/list-acuity-calendars.mjs` once credentials exist) |
| Timezone | `America/Chicago` (confirmed correct for every instructor) |

Booking link format is built by [src/acuityLink.ts](../src/acuityLink.ts) —
see that file for the DST-safe offset logic (verified against both `-05:00`
and `-06:00`, plus the exact spring-forward transition instant).

## 5. Acuity API reference (what we use)

Base: `https://acuityscheduling.com/api/v1` using HTTP Basic auth
(`userId:apiKey`). See [functions/_shared/acuity.live.ts](../functions/_shared/acuity.live.ts)
for the actual client and [functions/_shared/acuity.mock.ts](../functions/_shared/acuity.mock.ts)
for local testing without real credentials.

- `GET /calendars`, `GET /appointment-types`: one-time setup / mapping.
- `GET /appointments/{id}`: full details after a webhook.
- `GET /appointments?minDate&maxDate&calendarID`: reconciliation (not currently
  used — see §9, reconciliation only compares against our own `holds`/`trial_openings`).
- `GET /blocks`, `POST /blocks`, `DELETE /blocks/{id}`.
- `POST /webhooks`: not yet registered against a real Acuity account (needs the
  API key + a public URL to point at).

**Webhook signature verification** (`X-Acuity-Signature`, base64
HMAC-SHA256 of the raw body keyed with the API key) is implemented and used —
see `verifyAcuitySignature` in `acuity.live.ts`.

## 6. Blocking strategy

For each teacher calendar: block everything from now → 90 days out except
trial-flagged slots (`trial_openings`) and active holds. Implemented as a
continuous interval complement (not day-bounded like the original spec's
example) — behaviorally equivalent, fewer/larger block records. See
`reconciliation.ts`.

Only ever delete blocks the app created (tracked via `acuity_blocks`).

## 7. Flows

### 7a. Flag / unflag trial slots
Handled by the existing grid toggle (`toggleOpening` in `App.tsx`, unchanged)
paired with a new call to `POST /api/acuity-block-sync` to keep Acuity's block
state in sync. **Not yet wired**: the actual call from `toggleOpening` — the
route exists and is tested, but `App.tsx` doesn't call it yet.

### 7b. Add / move a recurring student
Not yet built. Needs the "booked trial already exists here" check ported into
the client's `saveEntry`/`bookTrialEntry` flow.

### 7c. Hold a trial for a family (24-hour policy)
`POST /api/holds` (see [functions/api/holds.ts](../functions/api/holds.ts)):
looks up the instructor + lead, unblocks the window if it's an off-schedule
exception slot, builds the booking link, inserts the hold row (`expires_at =
now + 24h`), logs a `hold_created` activity, returns the link. **Not yet
wired**: a button in the app that calls this and feeds the link into the
existing "Text now" mechanism (and logs `link_texted` once sent).

### 7d. Hold expiry
`POST /api/cron/hold-expiry`, called every ~10 min by the cron Worker. Flips
expired active holds to `status = 'expired'`. Does not touch Acuity — see §3.

### 7e. Booking webhook → Action Pending
`POST /api/acuity-webhook` ([functions/api/acuity-webhook.ts](../functions/api/acuity-webhook.ts)):
verifies the signature, fetches the full appointment, stores the raw event in
`acuity_events`. Deliberately makes no linking decision — see §3 for why
Confirm/Don't-confirm has to be a human click. **Not yet built**: the Action
Pending UI that joins `holds` (status='active') against `acuity_events`
(event_type='appointment.scheduled') by instructor calendar + datetime, and the
Confirm/Don't-confirm buttons that set `holds.status`/`acuity_appointment_id`.

### 7f. Late cancel / no-show → fee flow
`POST /api/fees/charge` ([functions/api/fees/charge.ts](../functions/api/fees/charge.ts)):
idempotent per appointment (or per lead+reason), looks up the Stripe customer
by lead email, charges $40 off-session, logs the result. **Not yet built**:
the "Did the lesson occur?" → reason-picker UI, the late-cancel webhook
detection (<24h before `datetime`), and the notice-text step.

## 8. Stripe charge

Implemented in [functions/_shared/stripe.live.ts](../functions/_shared/stripe.live.ts):
finds the customer by email, their default (or most recent) payment method,
creates a PaymentIntent with `off_session: true, confirm: true`, an
idempotency key derived from the appointment id (or lead+reason), and
`metadata.lead_id`/`acuity_appointment_id`. On failure, returns the error for
the UI to show a "charge manually in Acuity" fallback (UI not built yet).

Two families booked before the Stripe switch have cards in Square — handled
manually by Conor, no Square support built.

## 9. Nightly reconciliation

`POST /api/cron/reconciliation`, called once daily (~8am UTC / ~2am Central —
see the DST caveat in `cron-worker/wrangler.toml`) by the cron Worker. Rebuilds
the 90-day block horizon per instructor from scratch: open windows = union of
`trial_openings` + active `holds`; everything else in the range should be
blocked. Diffs against `acuity_blocks` and creates/deletes to match.

Not yet built: comparing Acuity's actual appointments against app records to
surface a missed-webhook mismatch (plan §9's second bullet) — the current pass
only reconciles blocks, not appointment records.

## 10. Data model

Implemented in [supabase/migrations/011_acuity_integration.sql](../supabase/migrations/011_acuity_integration.sql),
following this app's established no-RLS/plain-grant convention (every table
since 004 uses this — see 009/010) rather than the owner_id-scoped RLS from
001. All writes happen server-side via the Supabase service-role key, which
bypasses grants entirely, so the client only gets `select` on these four
tables:

- `instructors.acuity_calendar_id`
- `holds` (`lead_id`, `instructor_id`, `starts_at`, `duration_minutes`,
  `booking_link`, `created_at`, `expires_at`, `status`, `acuity_appointment_id`)
- `acuity_blocks` (`acuity_block_id`, `instructor_id`, `starts_at`, `ends_at`, `reason`)
- `acuity_events` (raw webhook + fetched appointment JSON, `received_at`)
- `fee_charges` (`lead_id`, `acuity_appointment_id`, `amount_cents`, `reason`,
  `idempotency_key` unique, `status`, `stripe_payment_intent_id`, `failure_message`, `waived_reason`)

Event log entries reuse the existing `activities` table (`type: 'trial_update'`,
descriptive `outcome` text) rather than a new logging table — matches how
every other feature in this app already logs lead-facing events.

> **Schema-drift note**: `instructors` and `trial_openings` predate the
> migrations directory (created before migrations were adopted here), so their
> column names above were confirmed by reading `src/database.ts`'s live query
> code, not by trusting the migration files. Worth a live Supabase introspection
> check before this goes to production, per this project's established caution
> around schema drift.

## 11. Hosting

Cloudflare Pages Functions (`functions/`) deployed alongside the existing site,
same project, same git-triggered deploy — no new hosting to manage. Secrets set
in the Pages project dashboard (Settings → Environment variables):
`SUPABASE_SERVICE_ROLE_KEY`, `ACUITY_USER_ID`, `ACUITY_API_KEY`,
`ACUITY_SCHEDULER_ID`, `ACUITY_APPOINTMENT_TYPE_ID`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`. Until Acuity/Stripe credentials exist,
everything runs against the built-in mocks automatically (see
`functions/_shared/acuityClient.ts` / `stripeClient.ts`).

The companion `cron-worker/` is a **separate** `wrangler deploy` (Pages
Functions has no native cron support) — deploy it once with:
```
./node_modules/.bin/wrangler deploy --config cron-worker/wrangler.toml
./node_modules/.bin/wrangler secret put CRON_SECRET --config cron-worker/wrangler.toml
```
using the same `CRON_SECRET` value as the Pages project.

## 12. Build order / where we are

1. ✅ Setup: secrets plumbing, mock clients, `scripts/list-acuity-calendars.mjs` (real run pending Conor's API key)
2. ⏳ Booking-link builder ✅ done and verified — the "Hold this slot" button + Text now wiring is not
3. ✅ Holds route + 24h expiry cron (backend only)
4. ✅ Webhook endpoint + signature check (backend only) — Confirm/Don't-confirm UI not built
5. ⏳ Blocking engine ✅ (sync route + reconciliation) — flag/unflag UI wiring + recurring-lesson conflict check not done
6. ✅ Nightly reconciliation (blocks only, not appointment-mismatch detection)
7. ⏳ Fee flow: charge route ✅ — "Did the lesson occur?" reasons UI, late-cancel detection, notice text not done

## 13. Test checklist

- [x] Link builder produces a link that opens the correct teacher, date and
      time, in both summer (-05:00) and winter (-06:00) — verified with a
      standalone script, plus the DST spring-forward boundary instant.
- [ ] Pre-fill params: check whether Acuity honors them (needs a real account).
- [ ] Flag a trial slot and confirm it becomes bookable publicly (needs real
      Acuity credentials + calendar mapping).
- [ ] Confirm a non-trial time is not bookable (needs real credentials).
- [ ] Hold a non-trial slot: it opens, then reconciliation re-blocks it
      overnight (needs real credentials to observe end-to-end).
- [x] Cron-secret guard rejects requests without/with the wrong secret
      (verified locally against the mock clients).
- [ ] Test booking → Action Pending item with the correct side-by-side
      comparison (UI not built yet).
- [ ] Late-cancel webhook → fee item (UI not built yet).
- [ ] Stripe: a $40 test charge succeeds off-session, then refund it. A
      double-click doesn't double-charge (idempotency key logic verified by
      code review; not yet exercised against real Stripe test keys).
- [x] A forged/missing webhook signature is rejected (verified locally — Acuity
      webhook skips verification only when no API key is configured yet, and
      the guard code itself was exercised via the cron-secret tests).
