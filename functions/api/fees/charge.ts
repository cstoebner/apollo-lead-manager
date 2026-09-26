import type { Env } from '../../_shared/env'
import { supabaseAdmin } from '../../_shared/supabaseAdmin'
import { getStripeClient } from '../../_shared/stripeClient'
import { withJsonErrors } from '../../_shared/handler'

const FEE_AMOUNT_CENTS = 4000

interface RequestBody {
  leadId: string
  acuityAppointmentId?: string
  reason: 'no_show' | 'late_cancel'
}

// Charges the $40 late-cancellation/no-show fee off-session. Idempotent per
// appointment (or per lead+reason if there's no appointment id) -- a double
// click just returns the first attempt's result instead of charging again,
// on top of Stripe's own Idempotency-Key protection for the API call itself.
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const body = (await context.request.json()) as RequestBody
  const idempotencyKey = `fee-${body.acuityAppointmentId ?? body.leadId}-${body.reason}`
  const db = supabaseAdmin(context.env)

  const { data: existing } = await db.from('fee_charges').select('*').eq('idempotency_key', idempotencyKey).maybeSingle()
  if (existing) return Response.json({ ok: existing.status === 'succeeded', alreadyProcessed: true, charge: existing })

  const { data: lead, error: leadError } = await db.from('leads').select('id, name, email').eq('id', body.leadId).single()
  if (leadError || !lead) return Response.json({ error: 'Lead not found.' }, { status: 404 })

  const stripe = getStripeClient(context.env)
  const match = lead.email ? await stripe.findCustomerAndPaymentMethod(lead.email) : null
  if (!match) {
    const { data: charge } = await db.from('fee_charges').insert({
      lead_id: lead.id, acuity_appointment_id: body.acuityAppointmentId, amount_cents: FEE_AMOUNT_CENTS, reason: body.reason,
      idempotency_key: idempotencyKey, status: 'failed', failure_message: 'No Stripe customer/payment method found for this email.',
    }).select().single()
    return Response.json({ error: 'No Stripe customer found for this email. Open the Acuity appointment to charge manually.', charge }, { status: 402 })
  }

  const result = await stripe.createOffSessionCharge({
    customerId: match.customerId,
    paymentMethodId: match.paymentMethodId,
    amountCents: FEE_AMOUNT_CENTS,
    description: `Late cancellation fee – trial lesson`,
    idempotencyKey,
    metadata: { lead_id: lead.id, ...(body.acuityAppointmentId ? { acuity_appointment_id: body.acuityAppointmentId } : {}) },
  })

  const { data: charge } = await db.from('fee_charges').insert({
    lead_id: lead.id,
    acuity_appointment_id: body.acuityAppointmentId,
    amount_cents: FEE_AMOUNT_CENTS,
    reason: body.reason,
    idempotency_key: idempotencyKey,
    status: result.status,
    stripe_payment_intent_id: result.paymentIntentId,
    failure_message: result.failureMessage,
  }).select().single()

  await db.from('activities').insert({
    lead_id: lead.id,
    type: 'trial_update',
    occurred_at: new Date().toISOString(),
    outcome: result.status === 'succeeded' ? '$40 late-cancellation fee charged' : `$40 fee charge failed: ${result.failureMessage}`,
  })

  if (result.status === 'failed') return Response.json({ error: result.failureMessage, charge }, { status: 402 })
  return Response.json({ ok: true, charge })
})
