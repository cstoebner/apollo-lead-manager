import type { supabaseAdmin } from './supabaseAdmin'
import type { AcuityClient } from './acuityTypes'
import { chicagoParts, friendlyTime } from './chicago'
import { parseAcuityTime } from './intake'

// Checks the three ways a trial can already be sitting in this exact window, and says WHO and WHEN so you don't have to
// hunt for it: a confirmed Acuity-booked hold, a trial booked through the in-app flow (schedule_entries kind='trial'),
// or a live booking in Acuity itself (which Apollo may not know about yet). NOTE: this does not (yet) check for a
// conflicting *recurring* lesson (schedule_entries kind='regular') -- that needs the day-of-week/biweekly-phase
// recurrence logic the client already has in entryOccursOnDate.
export type InstructorRef = { id: string; name: string; calendarId: string }

export async function findBookedTrialConflict(db: ReturnType<typeof supabaseAdmin>, acuity: AcuityClient, instructor: InstructorRef, start: Date, end: Date): Promise<string | null> {
  const at = `${friendlyTime(start)} with ${instructor.name}`
  const tail = 'Not re-blocking it. Cancel or move the trial first if you really want that time blocked.'

  const { data: confirmedHold } = await db.from('holds')
    .select('id, lead_id')
    .eq('instructor_id', instructor.id)
    .eq('status', 'confirmed')
    .lt('starts_at', end.toISOString())
    .gte('starts_at', start.toISOString())
    .maybeSingle()
  if (confirmedHold) {
    const { data: lead } = await db.from('leads').select('name, student_name').eq('id', confirmedHold.lead_id).maybeSingle()
    const who = lead ? (lead.student_name && lead.student_name !== lead.name ? `${lead.student_name} (lead: ${lead.name})` : lead.name) : 'a family'
    return `${who} has a trial booked through Acuity at ${at}. Find them on the Today page or the All leads list. ${tail}`
  }

  const { data: bookedEntry } = await db.from('schedule_entries')
    .select('id, student_name')
    .eq('instructor_id', instructor.id)
    .eq('kind', 'trial')
    .lt('starts_at', end.toISOString())
    .gte('starts_at', start.toISOString())
    .maybeSingle()
  if (bookedEntry) return `${bookedEntry.student_name} has a trial booked at ${at} (it's on the instructor schedule). ${tail}`

  // Acuity's own bookings: catches one Apollo hasn't heard about yet (it should be waiting as a card on Today).
  try {
    const day = chicagoParts(start).key
    const appointments = await acuity.listAppointments({ minDate: day, maxDate: day, calendarID: instructor.calendarId })
    const overlapping = appointments.find((item) => { const when = parseAcuityTime(item.datetime).getTime(); return when < end.getTime() && when + 30 * 60_000 > start.getTime() })
    if (overlapping) {
      const name = `${overlapping.firstName} ${overlapping.lastName}`.trim() || 'Someone'
      return `${name} has a booking in Acuity at ${at}. Apollo may not have linked it to a lead yet, so look for an "Acuity bookings" card on the Today page. ${tail}`
    }
  } catch (error) {
    console.warn('Could not check Acuity bookings before re-blocking:', error instanceof Error ? error.message : error)
  }
  return null
}
