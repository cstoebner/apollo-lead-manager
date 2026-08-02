import { supabase } from './supabase'
import type { Activity, Instructor, InstructorAvailability, Lead, ScheduleActivity, ScheduleEntry, TrialOpening } from './types'

export interface WorkspaceData {
  leads: Lead[]
  instructors: Instructor[]
  availability: InstructorAvailability[]
  entries: ScheduleEntry[]
  openings: TrialOpening[]
  scheduleActivities: ScheduleActivity[]
  instruments?: string[]
}

const client = () => {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

const assertOk = (error: { message: string } | null) => {
  if (error) throw new Error(error.message)
}

const shortTime = (value?: string | null) => value ? value.slice(0, 5) : undefined

export async function loadWorkspaceData(): Promise<WorkspaceData> {
  const db = client()
  const [leadResult, activityResult, instructorResult, availabilityResult, entryResult, openingResult, scheduleActivityResult, settingsResult] = await Promise.all([
    db.from('leads').select('*').order('received_at', { ascending: false }),
    db.from('activities').select('*').order('occurred_at', { ascending: true }),
    db.from('instructors').select('*').order('name', { ascending: true }),
    db.from('instructor_availability').select('*'),
    db.from('schedule_entries').select('*'),
    db.from('trial_openings').select('*').order('starts_at', { ascending: true }),
    db.from('schedule_activities').select('*').order('occurred_at', { ascending: true }),
    db.from('app_settings').select('*').maybeSingle(),
  ])

  ;[leadResult, activityResult, instructorResult, availabilityResult, entryResult, openingResult, scheduleActivityResult, settingsResult]
    .forEach((result) => assertOk(result.error))

  const activitiesByLead = new Map<string, Activity[]>()
  for (const row of activityResult.data ?? []) {
    const activity: Activity = { id: row.id, type: row.type, occurredAt: row.occurred_at, outcome: row.outcome }
    activitiesByLead.set(row.lead_id, [...(activitiesByLead.get(row.lead_id) ?? []), activity])
  }

  const instructors: Instructor[] = (instructorResult.data ?? []).map((row) => ({
    id: row.id, name: row.name, instruments: row.instruments ?? [],
  }))
  const instructorNames = new Map(instructors.map((instructor) => [instructor.id, instructor.name]))

  return {
    leads: (leadResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      studentName: row.student_name ?? undefined,
      phone: row.phone ?? '',
      email: row.email ?? '',
      instrument: row.instrument,
      receivedAt: row.received_at,
      source: row.source,
      campaign: row.campaign ?? '',
      status: row.status,
      activities: activitiesByLead.get(row.id) ?? [],
      trialAt: row.trial_at ?? undefined,
      holdFormComplete: Boolean(row.hold_form_complete),
      trialAttended: Boolean(row.trial_attended),
      enrolledAt: row.enrolled_at ?? undefined,
    })),
    instructors,
    availability: (availabilityResult.data ?? []).map((row) => ({
      id: row.id,
      instructorId: row.instructor_id,
      dayOfWeek: row.day_of_week,
      startTime: shortTime(row.start_time)!,
      endTime: shortTime(row.end_time)!,
    })),
    entries: (entryResult.data ?? []).map((row) => ({
      id: row.id,
      instructorId: row.instructor_id,
      leadId: row.lead_id ?? undefined,
      studentName: row.student_name,
      instrument: row.instrument,
      kind: row.kind,
      dayOfWeek: row.day_of_week ?? undefined,
      startTime: shortTime(row.start_time),
      startsAt: row.starts_at ?? undefined,
      startsOn: row.starts_on ?? undefined,
      endsOn: row.ends_on ?? undefined,
      skippedDates: row.skipped_dates ?? undefined,
    })),
    openings: (openingResult.data ?? []).flatMap((row) => {
      const instructor = instructorNames.get(row.instructor_id)
      return instructor ? [{ id: row.id, instructor, instruments: row.instruments ?? [], startsAt: row.starts_at }] : []
    }),
    scheduleActivities: (scheduleActivityResult.data ?? []).map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      action: row.action,
      instructor: row.instructor_name,
      details: row.details,
      studentName: row.student_name ?? undefined,
    })),
    instruments: settingsResult.data?.offered_instruments ?? undefined,
  }
}

const leadRow = (lead: Lead) => ({
  id: lead.id,
  name: lead.name,
  student_name: lead.studentName ?? null,
  phone: lead.phone || null,
  email: lead.email,
  instrument: lead.instrument,
  received_at: lead.receivedAt,
  source: lead.source,
  campaign: lead.campaign || null,
  status: lead.status,
  trial_at: lead.trialAt ?? null,
  hold_form_complete: lead.holdFormComplete,
  trial_attended: lead.trialAttended,
  enrolled_at: lead.enrolledAt ?? null,
})

export async function saveLead(lead: Lead) {
  const { error } = await client().from('leads').upsert(leadRow(lead))
  assertOk(error)
}

export async function updateLead(id: string, update: Partial<Lead>) {
  const row: Record<string, unknown> = {}
  if ('status' in update) row.status = update.status
  if ('trialAt' in update) row.trial_at = update.trialAt ?? null
  if ('holdFormComplete' in update) row.hold_form_complete = update.holdFormComplete
  if ('trialAttended' in update) row.trial_attended = update.trialAttended
  if ('enrolledAt' in update) row.enrolled_at = update.enrolledAt ?? null
  const { error } = await client().from('leads').update(row).eq('id', id)
  assertOk(error)
}

export async function saveActivity(leadId: string, activity: Activity) {
  const { error } = await client().from('activities').upsert({
    id: activity.id, lead_id: leadId, type: activity.type, occurred_at: activity.occurredAt, outcome: activity.outcome,
  })
  assertOk(error)
}

export async function removeActivity(activityId: string) {
  const { error } = await client().from('activities').delete().eq('id', activityId)
  assertOk(error)
}

async function syncRows(table: string, rows: Record<string, unknown>[], removedIds: string[]) {
  const db = client()
  if (removedIds.length) {
    const { error } = await db.from(table).delete().in('id', removedIds)
    assertOk(error)
  }
  if (rows.length) {
    const { error } = await db.from(table).upsert(rows)
    assertOk(error)
  }
}

export async function syncInstructors(previous: Instructor[], next: Instructor[]) {
  const nextIds = new Set(next.map((item) => item.id))
  const removed = previous.filter((item) => !nextIds.has(item.id))
  const db = client()
  for (const instructor of removed) {
    await Promise.all([
      db.from('trial_openings').delete().eq('instructor_id', instructor.id),
      db.from('schedule_entries').delete().eq('instructor_id', instructor.id),
      db.from('instructor_availability').delete().eq('instructor_id', instructor.id),
    ]).then((results) => results.forEach((result) => assertOk(result.error)))
    const { error } = await db.from('instructors').delete().eq('id', instructor.id)
    assertOk(error)
  }
  if (next.length) {
    const { error } = await db.from('instructors').upsert(next.map((item) => ({ id: item.id, name: item.name, instruments: item.instruments })))
    assertOk(error)
  }
}

export async function syncAvailability(previous: InstructorAvailability[], next: InstructorAvailability[]) {
  const nextIds = new Set(next.map((item) => item.id))
  await syncRows('instructor_availability', next.map((item) => ({
    id: item.id, instructor_id: item.instructorId, day_of_week: item.dayOfWeek, start_time: item.startTime, end_time: item.endTime,
  })), previous.filter((item) => !nextIds.has(item.id)).map((item) => item.id))
}

export async function syncEntries(previous: ScheduleEntry[], next: ScheduleEntry[]) {
  const nextIds = new Set(next.map((item) => item.id))
  await syncRows('schedule_entries', next.map((item) => ({
    id: item.id,
    instructor_id: item.instructorId,
    lead_id: item.leadId ?? null,
    student_name: item.studentName,
    instrument: item.instrument,
    kind: item.kind,
    day_of_week: item.dayOfWeek ?? null,
    start_time: item.startTime ?? null,
    starts_at: item.startsAt ?? null,
    starts_on: item.startsOn ?? null,
    ends_on: item.endsOn ?? null,
    skipped_dates: item.skippedDates ?? [],
  })), previous.filter((item) => !nextIds.has(item.id)).map((item) => item.id))
}

export async function syncOpenings(previous: TrialOpening[], next: TrialOpening[], instructors: Instructor[]) {
  const nextIds = new Set(next.map((item) => item.id))
  const idsByName = new Map(instructors.map((instructor) => [instructor.name, instructor.id]))
  const rows = next.map((item) => {
    const instructorId = idsByName.get(item.instructor)
    if (!instructorId) throw new Error(`Instructor ${item.instructor} was not found.`)
    return { id: item.id, instructor_id: instructorId, instruments: item.instruments, starts_at: item.startsAt }
  })
  await syncRows('trial_openings', rows, previous.filter((item) => !nextIds.has(item.id)).map((item) => item.id))
}

export async function saveScheduleActivity(activity: ScheduleActivity, instructorId?: string) {
  const { error } = await client().from('schedule_activities').upsert({
    id: activity.id,
    occurred_at: activity.occurredAt,
    action: activity.action,
    instructor_id: instructorId ?? null,
    instructor_name: activity.instructor,
    details: activity.details,
    student_name: activity.studentName ?? null,
  })
  assertOk(error)
}

export async function removeScheduleActivity(id: string) {
  const { error } = await client().from('schedule_activities').delete().eq('id', id)
  assertOk(error)
}

export async function saveSettings(instruments: string[]) {
  const db = client()
  const { data: { user }, error: userError } = await db.auth.getUser()
  assertOk(userError)
  if (!user) throw new Error('You are not signed in.')
  const { error } = await db.from('app_settings').upsert({ owner_id: user.id, offered_instruments: instruments }, { onConflict: 'owner_id' })
  assertOk(error)
}
