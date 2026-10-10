import type { Env } from './env'
import { supabaseAdmin } from './supabaseAdmin'
import { applyTemplate, defaultMessageTemplates } from '../../src/messageTemplates'
import { entryTakesSlot, friendlyTime, type ScheduleEntryRow } from './chicago'

type Db = ReturnType<typeof supabaseAdmin>

// Automatic lead intake. A Google Apps Script posts each new Meta lead (a row from the Lead Ads sheet) or
// Formspree email here; we normalize it, check for duplicates, create the lead, and queue a Day 0 email with
// the first two flagged trial openings. See docs/lead-intake-plan.md.

export type IntakeSource = 'meta' | 'formspree'
export interface IntakeInput { source: IntakeSource; externalId: string; receivedAt?: string; fields: Record<string, string> }

export interface IntakeLead {
  name: string
  studentName?: string
  email: string
  phone: string
  instruments: string[]
  source: 'Meta' | 'Website Traffic'
  campaign: string
  receivedAt: string
  notes: string[]
}

const MIN_LEAD_TIME_HOURS = 24 // never offer a time that starts sooner than this
const OFFER_COUNT = 2
const LOOKAHEAD_DAYS = 45

// ---------- reading the fields ----------

const normalizeKey = (key: string) => ` ${key.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
const blank = (value: unknown) => value === undefined || value === null || String(value).trim() === ''

// Whole-word match of any keyword against the field names -- Meta's column names vary by form
// ("what_is_the_age_of_the_student"), so exact names can't be relied on. Same idea as the Flag App script.
function pick(fields: Record<string, string>, ...keywords: string[]): string {
  const wanted = keywords.map(normalizeKey)
  for (const [key, value] of Object.entries(fields)) {
    if (blank(value)) continue
    const normalized = normalizeKey(key)
    if (wanted.some((keyword) => normalized.includes(keyword))) return String(value).trim()
  }
  return ''
}
const exact = (fields: Record<string, string>, key: string) => (blank(fields[key]) ? '' : String(fields[key]).trim())

// Meta delivers button/choice answers as slugs ("yes,_that's_fine"); free-text fields are left alone.
const deslug = (value: string) => value.replace(/_/g, ' ').trim()

const tidyName = (value: string) => {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) return trimmed
  return trimmed.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase())
}

export const digitsOf = (phone: string) => {
  const digits = phone.replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}
const prettyPhone = (phone: string) => {
  const digits = digitsOf(phone)
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : phone.trim()
}

const INSTRUMENT_ALIASES: Record<string, string[]> = {
  voice: ['vocal', 'vocals', 'voice', 'singing', 'sing'],
  drums: ['drum', 'drums', 'percussion'],
  saxophone: ['sax', 'saxophone'],
  piano: ['piano', 'keyboard'],
  guitar: ['guitar'],
}

function matchInstruments(raw: string, offered: string[]): string[] {
  const text = ` ${raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  return offered
    .map((instrument) => {
      const names = [instrument.toLowerCase(), ...(INSTRUMENT_ALIASES[instrument.toLowerCase()] ?? [])]
      const positions = names.map((name) => text.indexOf(` ${name} `)).filter((index) => index >= 0)
      return positions.length ? { instrument, at: Math.min(...positions) } : null
    })
    .filter((item): item is { instrument: string; at: number } => item !== null)
    .sort((a, b) => a.at - b.at)
    .map((item) => item.instrument)
}

export function normalizeIntake(input: IntakeInput, offeredInstruments: string[]): IntakeLead {
  const fields = input.fields
  const receivedAt = parseWhen(input.receivedAt) ?? parseWhen(pick(fields, 'created')) ?? new Date().toISOString()
  if (input.source === 'formspree') {
    const contact = tidyName(exact(fields, 'name'))
    const student = tidyName(exact(fields, 'student_name'))
    const notes = [
      ['Student type', exact(fields, 'student_type')],
      ['Experience', exact(fields, 'experience')],
      ['Requested instructor', exact(fields, 'requested_instructor')],
      ['Heard about us', exact(fields, 'flyer') || exact(fields, 'source')],
      ['Message', exact(fields, 'notes')],
    ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`)
    return {
      name: contact, studentName: student && student.toLowerCase() !== contact.toLowerCase() ? student : undefined,
      email: exact(fields, 'email').toLowerCase(), phone: prettyPhone(exact(fields, 'phone')),
      instruments: matchInstruments(exact(fields, 'instrument'), offeredInstruments),
      source: 'Website Traffic', campaign: 'Website inquiry', receivedAt, notes,
    }
  }
  // Meta lead-ad sheet row
  const first = pick(fields, 'first name', 'first_name')
  const last = pick(fields, 'last name', 'last_name')
  const instrumentRaw = deslug(pick(fields, 'instrument'))
  const notes = [
    ['Student age', deslug(pick(fields, 'age'))],
    ['SMS consent', deslug(pick(fields, 'sms', 'text message'))],
    ['Can travel to Chaska', deslug(pick(fields, 'travel'))],
  ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`)
  return {
    name: tidyName(pick(fields, 'full name', 'full_name') || `${first} ${last}`),
    email: pick(fields, 'email').toLowerCase(), phone: prettyPhone(pick(fields, 'phone')),
    instruments: matchInstruments(instrumentRaw, offeredInstruments),
    source: 'Meta', campaign: exact(fields, '__form') || 'Lead ad', receivedAt, notes: instrumentRaw && !matchInstruments(instrumentRaw, offeredInstruments).length ? [`Instrument answer: ${instrumentRaw}`, ...notes] : notes,
  }
}

function parseWhen(value?: string): string | undefined {
  if (!value) return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

// Returns a reason a lead can't be created automatically, or null if it's good to go.
export function intakeProblem(lead: IntakeLead, rawInstrument: string): string | null {
  if (!lead.name) return 'No name was found in the submission.'
  if (!lead.email && !lead.phone) return 'No email or phone number was found in the submission.'
  if (!lead.instruments.length) return `Couldn't tell which instrument they want${rawInstrument ? ` ("${rawInstrument}")` : ''}.`
  return null
}

// ---------- settings ----------

interface Settings { ownerId: string; offered: string[]; templates: Record<string, string>; autoSend: boolean }

export async function loadSettings(db: Db): Promise<Settings> {
  const { data, error } = await db.from('app_settings').select('owner_id, offered_instruments, message_templates, intake_auto_send').limit(1).maybeSingle()
  if (error || !data) throw new Error(`Could not load app settings: ${error?.message ?? 'no settings row'}`)
  return {
    ownerId: data.owner_id,
    offered: data.offered_instruments ?? [],
    templates: { ...defaultMessageTemplates, ...(data.message_templates ?? {}) },
    autoSend: Boolean(data.intake_auto_send),
  }
}

// ---------- duplicates ----------

export interface MatchedLead { id: string; name: string; student_name: string | null; email: string | null; phone: string | null; reason: string }

export async function findExistingLead(db: Db, lead: IntakeLead): Promise<MatchedLead | null> {
  const columns = 'id, name, student_name, email, phone'
  const found = new Map<string, { row: Omit<MatchedLead, 'reason'>; email: boolean; phone: boolean }>()
  const remember = (rows: Omit<MatchedLead, 'reason'>[] | null, kind: 'email' | 'phone') => {
    for (const row of rows ?? []) found.set(row.id, { row, email: found.get(row.id)?.email || kind === 'email', phone: found.get(row.id)?.phone || kind === 'phone' })
  }
  if (lead.email) {
    // ilike treats % and _ as wildcards; an over-match here is re-checked below.
    const { data } = await db.from('leads').select(columns).ilike('email', lead.email.replace(/[\\%_]/g, '\\$&'))
    remember((data ?? []).filter((row) => (row.email ?? '').trim().toLowerCase() === lead.email), 'email')
  }
  const digits = digitsOf(lead.phone)
  if (digits.length >= 10) {
    const { data } = await db.from('leads').select(columns).like('phone', `%${digits.slice(-4)}%`)
    remember((data ?? []).filter((row) => digitsOf(row.phone ?? '') === digits), 'phone')
  }
  const best = [...found.values()].sort((a, b) => Number(b.email) + Number(b.phone) - (Number(a.email) + Number(a.phone)))[0]
  if (!best) return null
  return { ...best.row, reason: best.email && best.phone ? 'same email and phone number' : best.email ? 'same email address' : 'same phone number' }
}

// ---------- offering times ----------

export interface ProposedTime { startsAt: string; label: string; instructor: string }

export async function pickOpenings(db: Db, instruments: string[], now = Date.now()): Promise<ProposedTime[]> {
  const from = new Date(now + MIN_LEAD_TIME_HOURS * 3_600_000)
  const to = new Date(now + LOOKAHEAD_DAYS * 86_400_000)
  const wanted = instruments.map((item) => item.toLowerCase())

  const [{ data: openings }, { data: instructors }, { data: holds }, { data: types }] = await Promise.all([
    db.from('trial_openings').select('instructor_id, instruments, starts_at').gte('starts_at', from.toISOString()).lte('starts_at', to.toISOString()).order('starts_at', { ascending: true }).limit(300),
    db.from('instructors').select('id, name, instruments, acuity_calendar_id'),
    db.from('holds').select('instructor_id, starts_at, status').in('status', ['active', 'confirmed']).gte('starts_at', from.toISOString()).lte('starts_at', to.toISOString()),
    db.from('acuity_appointment_types').select('instrument'),
  ])
  const bookable = new Set((types ?? []).map((row) => row.instrument.toLowerCase()))
  const instructorsById = new Map((instructors ?? []).map((row) => [row.id, row]))
  const candidates = (openings ?? []).filter((opening) => {
    const instructor = instructorsById.get(opening.instructor_id)
    if (!instructor?.acuity_calendar_id) return false // can't be booked online without a linked Acuity calendar
    const teaches = (opening.instruments?.length ? opening.instruments : instructor.instruments ?? []).map((item: string) => item.toLowerCase())
    return wanted.some((item) => teaches.includes(item) && bookable.has(item))
  })
  if (!candidates.length) return []

  const instructorIds = [...new Set(candidates.map((opening) => opening.instructor_id))]
  const { data: entries } = await db.from('schedule_entries')
    .select('instructor_id, kind, duration_minutes, day_of_week, start_time, starts_at, starts_on, ends_on, skipped_dates, repeat_interval_weeks')
    .in('instructor_id', instructorIds)

  const picked: ProposedTime[] = []
  for (const opening of candidates) {
    const start = new Date(opening.starts_at)
    const held = (holds ?? []).some((hold) => hold.instructor_id === opening.instructor_id && Date.parse(hold.starts_at) === start.getTime())
    const occupied = (entries as ScheduleEntryRow[] ?? []).some((entry) => entry.instructor_id === opening.instructor_id && entryTakesSlot(entry, start))
    if (held || occupied) continue
    picked.push({ startsAt: start.toISOString(), label: friendlyTime(start), instructor: instructorsById.get(opening.instructor_id)!.name })
    if (picked.length === OFFER_COUNT) break
  }
  return picked
}

// ---------- the email ----------

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function toHtml(text: string, bookingLink: string) {
  const blocks = text.split(/\n{2,}/).map((block) => {
    if (block.trim() === bookingLink) {
      return `<p style="margin:20px 0;"><a href="${escapeHtml(bookingLink)}" style="background:#2d3fe0;color:#ffffff;padding:13px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Book my free trial now</a></p>`
    }
    return `<p style="margin:0 0 16px;">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`
  })
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px;">${blocks.join('')}</div>`
}

// The studio's own Acuity booking page. `appointmentType` opens it on that instrument's free-trial lesson so the
// family skips choosing one; the other params pre-fill the form.
const BOOKING_PAGE = 'https://apollo-music-academy-booking.as.me/'

export function bookingLinkFor(appointmentTypeId: string, lead: IntakeLead) {
  const [firstName, ...rest] = lead.name.split(' ')
  const params = new URLSearchParams({ appointmentType: appointmentTypeId })
  if (firstName) params.set('firstName', firstName)
  if (rest.length) params.set('lastName', rest.join(' '))
  if (lead.email) params.set('email', lead.email)
  if (lead.phone) params.set('phone', lead.phone)
  return `${BOOKING_PAGE}?${params.toString()}`
}

export function composeEmail(templates: Record<string, string>, lead: IntakeLead, times: ProposedTime[], appointmentTypeId: string) {
  const bookingLink = bookingLinkFor(appointmentTypeId, lead)
  const vars: Record<string, string> = {
    firstName: lead.name.split(' ')[0],
    instrument: lead.instruments.map((item) => item.toLowerCase()).join(' and '),
    bookingLink,
    time1: times[0] ? `${times[0].label} with ${times[0].instructor}` : '',
    time2: times[1] ? `${times[1].label} with ${times[1].instructor}` : '',
  }
  const template = times.length >= OFFER_COUNT ? templates.intake_day0_email : templates.intake_day0_email_no_times
  const text = applyTemplate(template, vars)
  return { subject: applyTemplate(templates.intake_day0_email_subject, vars), text, html: toHtml(text, bookingLink) }
}

// ---------- creating the lead ----------

export interface IntakeOutcome { status: 'created' | 'needs_review' | 'failed' | 'already_processed'; leadId?: string; emailStatus?: string; note?: string }

async function setInbound(db: Db, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from('inbound_leads').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

// Creates the lead + its "new lead" activity + notes, and queues the Day 0 email (as a draft if auto-send is off).
export async function createLeadFromIntake(env: Env, db: Db, settings: Settings, inboundId: string, lead: IntakeLead): Promise<IntakeOutcome> {
  const leadId = crypto.randomUUID()
  const { error: leadError } = await db.from('leads').insert({
    id: leadId, owner_id: settings.ownerId, name: lead.name, student_name: lead.studentName ?? null, phone: lead.phone, email: lead.email,
    instrument: lead.instruments[0], instruments: lead.instruments, received_at: lead.receivedAt, source: lead.source, campaign: lead.campaign, status: 'hot',
  })
  if (leadError) throw new Error(`Could not create the lead: ${leadError.message}`)

  const activities = [{ lead_id: leadId, type: 'lead_created', occurred_at: lead.receivedAt, outcome: 'New lead received (automatic intake)' }]
  if (lead.notes.length) activities.push({ lead_id: leadId, type: 'note', occurred_at: lead.receivedAt, outcome: `From the form — ${lead.notes.join(' · ')}` })
  const { error: activityError } = await db.from('activities').insert(activities)
  if (activityError) throw new Error(`Could not log the new lead: ${activityError.message}`)

  let emailStatus: string | undefined
  if (lead.email) {
    const { data: types } = await db.from('acuity_appointment_types').select('instrument, appointment_type_id')
    const type = lead.instruments.map((item) => (types ?? []).find((row) => row.instrument.toLowerCase() === item.toLowerCase())).find(Boolean)
    if (type) {
      const times = await pickOpenings(db, lead.instruments)
      const email = composeEmail(settings.templates, lead, times, type.appointment_type_id)
      emailStatus = settings.autoSend ? 'queued' : 'draft'
      const { error: emailError } = await db.from('outbound_emails').insert({
        lead_id: leadId, inbound_lead_id: inboundId, kind: 'day0', to_email: lead.email, subject: email.subject, text_body: email.text, html_body: email.html,
        proposed_times: times, status: emailStatus,
      })
      if (emailError) throw new Error(`Could not queue the email: ${emailError.message}`)
    }
  }

  await setInbound(db, inboundId, { status: 'created', lead_id: leadId, note: emailStatus ? null : lead.email ? 'No email queued (no Acuity trial type for this instrument).' : 'No email address, so no email was queued.', resolved_at: new Date().toISOString() })
  return { status: 'created', leadId, emailStatus }
}

// ---------- the entry point ----------

export async function processIntake(env: Env, input: IntakeInput): Promise<IntakeOutcome> {
  const db = supabaseAdmin(env)
  const settings = await loadSettings(db)
  const lead = normalizeIntake(input, settings.offered)
  const rawInstrument = input.source === 'formspree' ? exact(input.fields, 'instrument') : deslug(pick(input.fields, 'instrument'))

  // Claim this submission first. The unique external_id is what makes a retried request harmless: a second
  // attempt finds the row and stops, instead of creating another lead.
  const { data: claimed, error: claimError } = await db.from('inbound_leads')
    .insert({ source: input.source, external_id: input.externalId, received_at: lead.receivedAt, raw: input.fields, parsed: lead, status: 'failed', note: 'Processing was interrupted before it finished.' })
    .select('id').single()
  if (claimError) {
    if (claimError.code === '23505') return { status: 'already_processed' }
    throw new Error(claimError.message)
  }

  const problem = intakeProblem(lead, rawInstrument)
  if (problem) { await setInbound(db, claimed.id, { status: 'failed', note: problem }); return { status: 'failed', note: problem } }

  const match = await findExistingLead(db, lead)
  if (match) {
    await setInbound(db, claimed.id, { status: 'needs_review', matched_lead_id: match.id, match_reason: match.reason, note: null })
    return { status: 'needs_review', leadId: match.id }
  }
  return createLeadFromIntake(env, db, settings, claimed.id, lead)
}

export async function resolveIntake(env: Env, inboundId: string, decision: 'same' | 'different' | 'dismiss') {
  const db = supabaseAdmin(env)
  const { data: row, error } = await db.from('inbound_leads').select('*').eq('id', inboundId).single()
  if (error || !row) throw new Error('That submission was not found.')
  if (row.status !== 'needs_review' && row.status !== 'failed') throw new Error('That submission has already been handled.')
  const lead = row.parsed as IntakeLead

  if (decision === 'dismiss') { await setInbound(db, inboundId, { status: 'dismissed', resolved_at: new Date().toISOString() }); return { status: 'dismissed' as const } }

  if (decision === 'same') {
    if (!row.matched_lead_id) throw new Error('There is no existing lead to merge this into.')
    const where = lead.source === 'Meta' ? 'Meta lead form' : 'website form'
    const details = [lead.studentName ? `Student: ${lead.studentName}` : '', lead.instruments.length ? `Instrument: ${lead.instruments.join(' / ')}` : '', ...lead.notes].filter(Boolean).join(' · ')
    const activity = { id: crypto.randomUUID(), lead_id: row.matched_lead_id, type: 'note', occurred_at: lead.receivedAt, outcome: `Also submitted the ${where}${details ? ` — ${details}` : ''}` }
    const { error: noteError } = await db.from('activities').insert(activity)
    if (noteError) throw new Error(noteError.message)
    await setInbound(db, inboundId, { status: 'merged', resolved_at: new Date().toISOString() })
    return { status: 'merged' as const, leadId: row.matched_lead_id as string, activity: { id: activity.id, type: 'note', occurredAt: activity.occurred_at, outcome: activity.outcome } }
  }

  const settings = await loadSettings(db)
  const outcome = await createLeadFromIntake(env, db, settings, inboundId, lead)
  return { ...outcome, status: 'created' as const }
}
