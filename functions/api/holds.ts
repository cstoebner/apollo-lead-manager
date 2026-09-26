import type { Env } from '../_shared/env'
import { supabaseAdmin } from '../_shared/supabaseAdmin'
import { getAcuityClient } from '../_shared/acuityClient'
import { buildAcuityBookingLink } from '../../src/acuityLink'
import { withJsonErrors } from '../_shared/handler'

const HOLD_HOURS = 24

interface RequestBody {
  leadId: string
  instructorId: string
  startsAt: string
  durationMinutes?: number
}

// Creates a 24-hour hold for a family and returns the Acuity booking link to
// text them. If the slot isn't already a flagged Trial Opening (the rare
// off-schedule exception case), this also temporarily deletes any block
// covering it -- see docs/acuity-integration-plan.md section 7c/7d for why the
// block is NOT automatically restored on expiry (nightly reconciliation does
// that as part of its normal every-night sweep instead).
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const body = (await context.request.json()) as RequestBody
  const durationMinutes = body.durationMinutes ?? 30
  const start = new Date(body.startsAt)
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const db = supabaseAdmin(context.env)
  const acuity = getAcuityClient(context.env)

  const [{ data: instructor, error: instructorError }, { data: lead, error: leadError }] = await Promise.all([
    db.from('instructors').select('id, name, acuity_calendar_id').eq('id', body.instructorId).single(),
    db.from('leads').select('id, name, student_name, phone, email').eq('id', body.leadId).single(),
  ])
  if (instructorError || !instructor) return Response.json({ error: 'Instructor not found.' }, { status: 404 })
  if (leadError || !lead) return Response.json({ error: 'Lead not found.' }, { status: 404 })
  if (!instructor.acuity_calendar_id) return Response.json({ error: `${instructor.name} has no Acuity calendar mapped yet.` }, { status: 400 })
  if (!context.env.ACUITY_SCHEDULER_ID || !context.env.ACUITY_APPOINTMENT_TYPE_ID) {
    return Response.json({ error: 'ACUITY_SCHEDULER_ID / ACUITY_APPOINTMENT_TYPE_ID are not configured yet.' }, { status: 400 })
  }

  const { data: openingMatch } = await db.from('trial_openings')
    .select('id')
    .eq('instructor_id', instructor.id)
    .eq('starts_at', start.toISOString())
    .maybeSingle()

  if (!openingMatch) {
    const { data: overlapping } = await db.from('acuity_blocks')
      .select('id, acuity_block_id')
      .eq('instructor_id', instructor.id)
      .lt('starts_at', end.toISOString())
      .gt('ends_at', start.toISOString())
    for (const block of overlapping ?? []) {
      await acuity.deleteBlock(block.acuity_block_id)
      await db.from('acuity_blocks').delete().eq('id', block.id)
    }
  }

  const [firstName, ...rest] = lead.name.split(' ')
  const bookingLink = buildAcuityBookingLink({
    schedulerId: context.env.ACUITY_SCHEDULER_ID,
    appointmentTypeId: context.env.ACUITY_APPOINTMENT_TYPE_ID,
    calendarId: instructor.acuity_calendar_id,
    startsAt: start,
    prefill: { firstName, lastName: rest.join(' '), email: lead.email ?? undefined, phone: lead.phone ?? undefined },
  })

  const expiresAt = new Date(start.getTime())
  expiresAt.setTime(Date.now() + HOLD_HOURS * 60 * 60_000)

  const { data: hold, error: holdError } = await db.from('holds').insert({
    lead_id: lead.id,
    instructor_id: instructor.id,
    starts_at: start.toISOString(),
    duration_minutes: durationMinutes,
    booking_link: bookingLink,
    expires_at: expiresAt.toISOString(),
    status: 'active',
  }).select('id').single()
  if (holdError || !hold) return Response.json({ error: holdError?.message ?? 'Could not create the hold.' }, { status: 500 })

  await db.from('activities').insert({
    lead_id: lead.id,
    type: 'trial_update',
    occurred_at: new Date().toISOString(),
    outcome: `Hold created with ${instructor.name} — expires in 24 hours if not booked`,
  })

  return Response.json({ ok: true, holdId: hold.id, bookingLink })
})
