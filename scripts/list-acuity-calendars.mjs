#!/usr/bin/env node
// One-time setup helper. Once Conor has the Acuity User ID + API key, run:
//   ACUITY_USER_ID=... ACUITY_API_KEY=... node scripts/list-acuity-calendars.mjs
// and match each printed calendar name to an instructor, then set
// instructors.acuity_calendar_id (via Settings, once that UI exists, or
// directly in the Supabase table editor for now).

const userId = process.env.ACUITY_USER_ID
const apiKey = process.env.ACUITY_API_KEY
if (!userId || !apiKey) {
  console.error('Set ACUITY_USER_ID and ACUITY_API_KEY in the environment first.')
  process.exit(1)
}

const authHeader = `Basic ${Buffer.from(`${userId}:${apiKey}`).toString('base64')}`

async function get(path) {
  const response = await fetch(`https://acuityscheduling.com/api/v1${path}`, { headers: { Authorization: authHeader } })
  if (!response.ok) throw new Error(`GET ${path} failed: ${response.status} ${await response.text()}`)
  return response.json()
}

const [calendars, appointmentTypes] = await Promise.all([get('/calendars'), get('/appointment-types')])

console.log('\nCalendars (instructor -> acuity_calendar_id):')
for (const calendar of calendars) console.log(`  ${calendar.name.padEnd(24)} ${calendar.id}`)

console.log('\nAppointment types (find "Trial Lesson" -> ACUITY_APPOINTMENT_TYPE_ID):')
for (const type of appointmentTypes) console.log(`  ${type.name.padEnd(24)} ${type.id}`)
