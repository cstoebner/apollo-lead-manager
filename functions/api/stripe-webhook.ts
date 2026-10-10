import type { Env } from '../_shared/env'
import { supabaseAdmin } from '../_shared/supabaseAdmin'
import { verifyStripeSignature } from '../_shared/stripe.live'
import { withJsonErrors } from '../_shared/handler'

// Only handles charge.dispute.created -- the one Stripe event this app actually
// needs (per Conor: the off-session charge itself returns success/failure
// synchronously, so no webhook is needed for that; a dispute is the one thing
// that can happen later and needs to reach the chargeback-evidence trail).
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const rawBody = await context.request.text()

  if (context.env.STRIPE_WEBHOOK_SECRET) {
    const valid = await verifyStripeSignature(rawBody, context.request.headers.get('Stripe-Signature'), context.env.STRIPE_WEBHOOK_SECRET)
    if (!valid) return new Response('Invalid signature', { status: 401 })
  }

  const event = JSON.parse(rawBody) as { type: string; data: { object: { id: string; payment_intent: string; reason?: string } } }
  if (event.type !== 'charge.dispute.created') return Response.json({ ok: true, ignored: event.type })

  const db = supabaseAdmin(context.env)
  const paymentIntentId = event.data.object.payment_intent
  const { data: charge } = await db.from('fee_charges').select('id, lead_id').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle()
  if (!charge) return Response.json({ ok: true, warning: `No fee_charges row found for payment_intent ${paymentIntentId}` })

  await db.from('activities').insert({
    lead_id: charge.lead_id,
    type: 'trial_update',
    occurred_at: new Date().toISOString(),
    outcome: `Dispute opened on the $40 late-cancellation charge (reason: ${event.data.object.reason ?? 'unknown'})`,
  })

  return Response.json({ ok: true })
})
