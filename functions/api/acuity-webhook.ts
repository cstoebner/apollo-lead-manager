import type { Env } from '../_shared/env'
import { supabaseAdmin } from '../_shared/supabaseAdmin'
import { getAcuityClient } from '../_shared/acuityClient'
import { verifyAcuitySignature } from '../_shared/acuity.live'
import { withJsonErrors } from '../_shared/handler'

// Records every appointment.* webhook as a raw event. Deliberately does NOT
// decide anything here (e.g. auto-linking a booking to a hold, or flagging a
// late cancel) -- per the ground rules, only a human "Confirm/Don't confirm"
// click should link a hold to a real Acuity booking. That Action Pending UI is
// the next phase of this build (see docs/acuity-integration-plan.md); this
// route's job is just to capture events reliably and safely (signature
// verified) so nothing is missed while that UI gets built.
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const rawBody = await context.request.text()

  if (context.env.ACUITY_API_KEY) {
    const signatureHeader = context.request.headers.get('X-Acuity-Signature')
    const valid = await verifyAcuitySignature(rawBody, signatureHeader, context.env.ACUITY_API_KEY)
    if (!valid) return new Response('Invalid signature', { status: 401 })
  }

  const form = new URLSearchParams(rawBody)
  const action = form.get('action') ?? 'unknown'
  const appointmentId = form.get('id')

  const db = supabaseAdmin(context.env)
  let appointment: unknown = null
  if (appointmentId) {
    try {
      appointment = await getAcuityClient(context.env).getAppointment(appointmentId)
    } catch (error) {
      // Store the event anyway -- a failed fetch shouldn't mean we silently drop it.
      appointment = { fetchError: error instanceof Error ? error.message : String(error) }
    }
  }

  const { error } = await db.from('acuity_events').insert({
    acuity_appointment_id: appointmentId,
    event_type: action,
    payload: { form: Object.fromEntries(form.entries()), appointment },
  })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
})
