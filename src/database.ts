import { supabase } from './supabase'
import type { AcuityEvent, Activity, FeeCharge, Hold, InboundLead, Instructor, InstructorAvailability, Lead, OutboundEmail, ScheduleActivity, ScheduleEntry, TrialOpening } from './types'

export interface WorkspaceData {
  leads: Lead[]
  instructors: Instructor[]
  availability: InstructorAvailability[]
  entries: ScheduleEntry[]
  openings: TrialOpening[]
  scheduleActivities: ScheduleActivity[]
  instruments?: string[]
  messageTemplates?: Record<string, string>
  intakeAutoSend?: boolean
}

const client = () => {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

const assertOk = (error: { message: string } | null) => {
  if (error) throw new Error(error.message)
}

const shortTime = (value?: string | null) => value ? value.slice(0, 5) : undefined

// PostgREST caps rows per request (commonly 1000) unless explicitly paginated. Without this,
// a table that grows past that cap silently drops everything past the cutoff on every load —
// with ascending order, that means the newest rows (recent activity) are the ones that vanish.
const PAGE_SIZE = 1000

async function fetchAllRows(
  db: ReturnType<typeof client>,
  table: string,
  orderColumn: string,
  ascending: boolean,
): Promise<{ data: any[] | null; error: { message: string } | null }> {
  const rows: any[] = []
  let from = 0
  for (;;) {
    const { data, error } = await db.from(table).select('*').order(orderColumn, { ascending }).range(from, from + PAGE_SIZE - 1)
    if (error) return { data: null, error }
    if (!data || data.length === 0) break
    rows.push(...data)
    from += data.length
  }
  return { data: rows, error: null }
}

const leadFromRow = (row: any, activities: Activity[]): Lead => ({
  id: row.id,
  name: row.name,
  studentName: row.student_name ?? undefined,
  phone: row.phone ?? '',
  email: row.email ?? '',
  instruments: row.instruments?.length ? row.instruments : (row.instrument ? [row.instrument] : []),
  receivedAt: row.received_at,
  source: row.source,
  campaign: row.campaign ?? '',
  status: row.status,
  activities,
  trialAt: row.trial_at ?? undefined,
  holdFormComplete: Boolean(row.hold_form_complete),
  trialAttended: Boolean(row.trial_attended),
  enrolledAt: row.enrolled_at ?? undefined,
  enrollmentAgreementSigned: Boolean(row.enrollment_agreement_signed),
  followUpAt: row.follow_up_at ?? undefined,
  followUpNote: row.follow_up_note ?? undefined,
  householdId: row.household_id ?? undefined,
  cadenceShiftDays: row.cadence_shift_days ?? undefined,
  cadencePauseUntil: row.cadence_pause_until ?? undefined,
  cadencePauseStartedAt: row.cadence_pause_started_at ?? undefined,
})

const activityFromRow = (row: any): Activity => ({ id: row.id, type: row.type, occurredAt: row.occurred_at, outcome: row.outcome })

export async function loadWorkspaceData(): Promise<WorkspaceData> {
  const db = client()
  const [leadResult, activityResult, instructorResult, availabilityResult, entryResult, openingResult, scheduleActivityResult, settingsResult] = await Promise.all([
    fetchAllRows(db, 'leads', 'received_at', false),
    fetchAllRows(db, 'activities', 'occurred_at', true),
    fetchAllRows(db, 'instructors', 'name', true),
    fetchAllRows(db, 'instructor_availability', 'id', true),
    fetchAllRows(db, 'schedule_entries', 'id', true),
    fetchAllRows(db, 'trial_openings', 'starts_at', true),
    fetchAllRows(db, 'schedule_activities', 'occurred_at', true),
    db.from('app_settings').select('*').maybeSingle(),
  ])

  ;[leadResult, activityResult, instructorResult, availabilityResult, entryResult, openingResult, scheduleActivityResult, settingsResult]
    .forEach((result) => assertOk(result.error))

  const activitiesByLead = new Map<string, Activity[]>()
  for (const row of activityResult.data ?? []) {
    const activity = activityFromRow(row)
    activitiesByLead.set(row.lead_id, [...(activitiesByLead.get(row.lead_id) ?? []), activity])
  }

  const instructors: Instructor[] = (instructorResult.data ?? []).map((row) => ({
    id: row.id, name: row.name, instruments: row.instruments ?? [], acuityCalendarId: row.acuity_calendar_id ?? undefined,
  }))
  const instructorNames = new Map(instructors.map((instructor) => [instructor.id, instructor.name]))

  return {
    leads: (leadResult.data ?? []).map((row) => leadFromRow(row, activitiesByLead.get(row.id) ?? [])),
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
      durationMinutes: row.duration_minutes ?? 30,
      dayOfWeek: row.day_of_week ?? undefined,
      startTime: shortTime(row.start_time),
      startsAt: row.starts_at ?? undefined,
      startsOn: row.starts_on ?? undefined,
      endsOn: row.ends_on ?? undefined,
      skippedDates: row.skipped_dates ?? undefined,
      repeatIntervalWeeks: row.repeat_interval_weeks ?? 1,
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
    messageTemplates: settingsResult.data?.message_templates ?? undefined,
    intakeAutoSend: Boolean(settingsResult.data?.intake_auto_send),
  }
}

export interface AcuityData { holds: Hold[]; events: AcuityEvent[]; feeCharges: FeeCharge[] }

// Loaded separately from the main workspace (and refreshed on a timer) so a problem with these
// read-only Acuity tables can never block the rest of the app from loading.
export async function loadAcuityData(): Promise<AcuityData> {
  const db = client()
  const [holdResult, eventResult, feeResult] = await Promise.all([
    fetchAllRows(db, 'holds', 'created_at', true),
    fetchAllRows(db, 'acuity_events', 'received_at', true),
    fetchAllRows(db, 'fee_charges', 'created_at', true),
  ])
  ;[holdResult, eventResult, feeResult].forEach((result) => assertOk(result.error))
  return {
    holds: (holdResult.data ?? []).map((row): Hold => ({
      id: row.id, leadId: row.lead_id, instructorId: row.instructor_id, startsAt: row.starts_at, durationMinutes: row.duration_minutes ?? 30,
      bookingLink: row.booking_link, createdAt: row.created_at, expiresAt: row.expires_at, status: row.status, acuityAppointmentId: row.acuity_appointment_id ?? undefined,
    })),
    events: (eventResult.data ?? []).map((row): AcuityEvent => ({
      id: row.id, acuityAppointmentId: row.acuity_appointment_id ?? undefined, eventType: row.event_type,
      appointment: row.payload?.appointment && !row.payload.appointment.fetchError ? row.payload.appointment : undefined,
      receivedAt: row.received_at, handledAt: row.handled_at ?? undefined, handledAs: row.handled_as ?? undefined,
    })),
    feeCharges: (feeResult.data ?? []).map((row): FeeCharge => ({
      id: row.id, leadId: row.lead_id, acuityAppointmentId: row.acuity_appointment_id ?? undefined, amountCents: row.amount_cents, reason: row.reason,
      status: row.status, failureMessage: row.failure_message ?? undefined, waivedReason: row.waived_reason ?? undefined, createdAt: row.created_at,
    })),
  }
}

const leadRow = (lead: Lead) => ({
  id: lead.id,
  name: lead.name,
  student_name: lead.studentName ?? null,
  phone: lead.phone || '',
  email: lead.email,
  instrument: lead.instruments[0] ?? '',
  instruments: lead.instruments,
  received_at: lead.receivedAt,
  source: lead.source,
  campaign: lead.campaign || '',
  status: lead.status,
  trial_at: lead.trialAt ?? null,
  hold_form_complete: lead.holdFormComplete,
  trial_attended: lead.trialAttended,
  enrolled_at: lead.enrolledAt ?? null,
  enrollment_agreement_signed: lead.enrollmentAgreementSigned ?? false,
  follow_up_at: lead.followUpAt ?? null,
  follow_up_note: lead.followUpNote ?? null,
  household_id: lead.householdId ?? null,
  cadence_shift_days: lead.cadenceShiftDays ?? null,
  cadence_pause_until: lead.cadencePauseUntil ?? null,
  cadence_pause_started_at: lead.cadencePauseStartedAt ?? null,
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
  if ('enrollmentAgreementSigned' in update) row.enrollment_agreement_signed = update.enrollmentAgreementSigned
  if ('followUpAt' in update) row.follow_up_at = update.followUpAt ?? null
  if ('followUpNote' in update) row.follow_up_note = update.followUpNote ?? null
  if ('householdId' in update) row.household_id = update.householdId ?? null
  if ('cadenceShiftDays' in update) row.cadence_shift_days = update.cadenceShiftDays ?? null
  if ('cadencePauseUntil' in update) row.cadence_pause_until = update.cadencePauseUntil ?? null
  if ('cadencePauseStartedAt' in update) row.cadence_pause_started_at = update.cadencePauseStartedAt ?? null
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

export async function removeLead(leadId: string) {
  const db = client()
  const scheduleResult = await db.from('schedule_entries').delete().eq('lead_id', leadId)
  assertOk(scheduleResult.error)
  const activityResult = await db.from('activities').delete().eq('lead_id', leadId)
  assertOk(activityResult.error)
  const leadResult = await db.from('leads').delete().eq('id', leadId)
  assertOk(leadResult.error)
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
    const { error } = await db.from('instructors').upsert(next.map((item) => ({ id: item.id, name: item.name, instruments: item.instruments, ...(item.acuityCalendarId !== undefined ? { acuity_calendar_id: item.acuityCalendarId || null } : {}) })))
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
    duration_minutes: item.durationMinutes,
    day_of_week: item.dayOfWeek ?? null,
    start_time: item.startTime ?? null,
    starts_at: item.startsAt ?? null,
    starts_on: item.startsOn ?? null,
    ends_on: item.endsOn ?? null,
    skipped_dates: item.skippedDates ?? [],
    repeat_interval_weeks: item.repeatIntervalWeeks ?? 1,
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

export async function saveMessageTemplates(templates: Record<string, string>) {
  const db = client()
  const { data: { user }, error: userError } = await db.auth.getUser()
  assertOk(userError)
  if (!user) throw new Error('You are not signed in.')
  const { error } = await db.from('app_settings').upsert({ owner_id: user.id, message_templates: templates }, { onConflict: 'owner_id' })
  assertOk(error)
}

export interface IntakeData { inbound: InboundLead[]; emails: OutboundEmail[] }

// Submissions waiting on a decision (possible duplicates, unreadable ones) and Day 0 emails that need attention
// (drafts to approve, failed sends). Read-only; every change goes through /api/inbound/*.
export async function loadIntakeData(): Promise<IntakeData> {
  const db = client()
  const [inboundResult, emailResult] = await Promise.all([
    db.from('inbound_leads').select('*').in('status', ['needs_review', 'failed']).order('created_at', { ascending: true }).limit(100),
    db.from('outbound_emails').select('*').in('status', ['draft', 'failed', 'queued', 'sending']).order('created_at', { ascending: true }).limit(100),
  ])
  assertOk(inboundResult.error)
  assertOk(emailResult.error)
  return {
    inbound: (inboundResult.data ?? []).map((row): InboundLead => ({
      id: row.id, source: row.source, receivedAt: row.received_at, parsed: row.parsed, status: row.status,
      matchedLeadId: row.matched_lead_id ?? undefined, matchReason: row.match_reason ?? undefined, note: row.note ?? undefined, createdAt: row.created_at,
    })),
    emails: (emailResult.data ?? []).map((row): OutboundEmail => ({
      id: row.id, leadId: row.lead_id, toEmail: row.to_email, subject: row.subject, textBody: row.text_body, status: row.status,
      error: row.error ?? undefined, proposedTimes: row.proposed_times ?? [], createdAt: row.created_at,
    })),
  }
}

// Leads and notes the server created or added since `sinceIso` (automatic intake, merged duplicates, emails logged
// as sent). The app only loads everything once, so this is how those show up without a reload.
export async function loadChangesSince(sinceIso: string): Promise<{ leads: Lead[]; activities: { leadId: string; activity: Activity }[] }> {
  const db = client()
  const [leadResult, activityResult] = await Promise.all([
    db.from('leads').select('*').gte('created_at', sinceIso).limit(200),
    db.from('activities').select('*').gte('created_at', sinceIso).order('occurred_at', { ascending: true }).limit(500),
  ])
  assertOk(leadResult.error)
  assertOk(activityResult.error)
  const activities = activityResult.data ?? []
  const byLead = new Map<string, Activity[]>()
  for (const row of activities) byLead.set(row.lead_id, [...(byLead.get(row.lead_id) ?? []), activityFromRow(row)])
  return {
    leads: (leadResult.data ?? []).map((row) => leadFromRow(row, byLead.get(row.id) ?? [])),
    activities: activities.map((row) => ({ leadId: row.lead_id, activity: activityFromRow(row) })),
  }
}

export async function saveIntakeAutoSend(value: boolean) {
  const db = client()
  const { data: { user }, error: userError } = await db.auth.getUser()
  assertOk(userError)
  if (!user) throw new Error('You are not signed in.')
  const { error } = await db.from('app_settings').upsert({ owner_id: user.id, intake_auto_send: value }, { onConflict: 'owner_id' })
  assertOk(error)
}
