import type { Env } from '../../_shared/env'
import { supabaseAdmin } from '../../_shared/supabaseAdmin'
import { withJsonErrors } from '../../_shared/handler'
import { requireSignedInUser } from '../../_shared/auth'

interface RequestBody {
  action: 'release' | 'confirm' | 'unmatched' | 'dismiss_event'
  holdId?: string
  eventId?: string
  acuityAppointmentId?: string
  handledAs?: string
}

// Every change to a hold's status (and marking a booking/cancellation card as handled) goes through
// here, because the app itself can only read these tables. Never touches Acuity: per the ground rules
// the app never cancels or reschedules a real Acuity appointment.
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = await requireSignedInUser(context.request, context.env)
  if (authError) return authError
  const body = (await context.request.json()) as RequestBody
  const db = supabaseAdmin(context.env)

  if (body.action !== 'dismiss_event') {
    if (!body.holdId) return Response.json({ error: 'holdId is required.' }, { status: 400 })
    const update = body.action === 'release' ? { status: 'expired' }
      : body.action === 'confirm' ? { status: 'confirmed', acuity_appointment_id: body.acuityAppointmentId ?? null }
      : { status: 'unmatched' }
    const query = db.from('holds').update(update).eq('id', body.holdId)
    const { error } = await (body.action === 'release' ? query.eq('status', 'active') : query)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  if (body.eventId) {
    const { error } = await db.from('acuity_events').update({ handled_at: new Date().toISOString(), handled_as: body.handledAs ?? body.action }).eq('id', body.eventId)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
})
