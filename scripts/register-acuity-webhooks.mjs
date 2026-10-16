#!/usr/bin/env node
// One-time setup: tells Acuity to notify the app whenever a booking is made, moved, changed or canceled.
// Safe to re-run -- it only registers events that aren't registered yet.
//   ACUITY_USER_ID=... ACUITY_API_KEY=... node scripts/register-acuity-webhooks.mjs

const userId = process.env.ACUITY_USER_ID
const apiKey = process.env.ACUITY_API_KEY
if (!userId || !apiKey) {
  console.error('Set ACUITY_USER_ID and ACUITY_API_KEY in the environment first.')
  process.exit(1)
}

const TARGET = 'https://apollo-lead-manager.pages.dev/api/acuity-webhook'
const EVENTS = ['appointment.scheduled', 'appointment.rescheduled', 'appointment.canceled', 'appointment.changed']
const authHeader = `Basic ${Buffer.from(`${userId}:${apiKey}`).toString('base64')}`

async function call(method, path, body) {
  const response = await fetch(`https://acuityscheduling.com/api/v1${path}`, {
    method,
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}

const existing = (await call('GET', '/webhooks')) ?? []
console.log(`\nWebhooks already registered: ${existing.length}`)
for (const hook of existing) console.log(`  ${hook.event}  ->  ${hook.target}`)

for (const event of EVENTS) {
  if (existing.some((hook) => hook.event === event && hook.target === TARGET)) { console.log(`  ✓ ${event} already registered`); continue }
  await call('POST', '/webhooks', { event, target: TARGET })
  console.log(`  + registered ${event}`)
}
console.log('\nDone. Acuity will now notify the app about bookings.')
