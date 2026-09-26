import type { Env } from '../../_shared/env'
import { requireCronSecret } from '../../_shared/cronAuth'
import { supabaseAdmin } from '../../_shared/supabaseAdmin'
import { getAcuityClient } from '../../_shared/acuityClient'
import { withJsonErrors } from '../../_shared/handler'

const HORIZON_DAYS = 90
const TRIAL_OPENING_DURATION_MINUTES = 30 // trial_openings doesn't store a duration -- every existing opening is a 30-min slot (see toggleOpening in App.tsx).

type Interval = [number, number] // epoch ms

// Runs nightly (~2am Central, triggered by the companion cron Worker). For each
// instructor's calendar, blocks everything in the 90-day horizon except trial
// openings and active holds -- recomputed from scratch every run, which is what
// actually restores a block after a hold expires (see hold-expiry.ts) rather
// than that cron doing it directly. Also acts as the safety net for the rare
// cases the real-time paths don't cover (a missed webhook, a manual booking
// that happened to land on an already-public slot, etc).
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = requireCronSecret(context.request, context.env)
  if (authError) return authError

  const db = supabaseAdmin(context.env)
  const acuity = getAcuityClient(context.env)
  const now = Date.now()
  const horizonEnd = now + HORIZON_DAYS * 86_400_000

  const { data: instructors, error: instructorsError } = await db.from('instructors').select('id, name, acuity_calendar_id').not('acuity_calendar_id', 'is', null)
  if (instructorsError) return Response.json({ error: instructorsError.message }, { status: 500 })

  const summary: Record<string, { created: number; removed: number }> = {}

  for (const instructor of instructors ?? []) {
    const [{ data: openings }, { data: holds }, { data: existingBlocks }] = await Promise.all([
      db.from('trial_openings').select('starts_at').eq('instructor_id', instructor.id).gte('starts_at', new Date(now).toISOString()).lte('starts_at', new Date(horizonEnd).toISOString()),
      db.from('holds').select('starts_at, duration_minutes').eq('instructor_id', instructor.id).eq('status', 'active').gte('starts_at', new Date(now).toISOString()).lte('starts_at', new Date(horizonEnd).toISOString()),
      db.from('acuity_blocks').select('id, acuity_block_id, starts_at, ends_at').eq('instructor_id', instructor.id),
    ])

    const openIntervals: Interval[] = [
      ...(openings ?? []).map((row): Interval => { const start = Date.parse(row.starts_at); return [start, start + TRIAL_OPENING_DURATION_MINUTES * 60_000] }),
      ...(holds ?? []).map((row): Interval => { const start = Date.parse(row.starts_at); return [start, start + (row.duration_minutes ?? 30) * 60_000] }),
    ].sort((a, b) => a[0] - b[0])

    const mergedOpenIntervals: Interval[] = []
    for (const [start, end] of openIntervals) {
      const last = mergedOpenIntervals[mergedOpenIntervals.length - 1]
      if (last && start <= last[1]) last[1] = Math.max(last[1], end)
      else mergedOpenIntervals.push([start, end])
    }

    const neededBlocks: Interval[] = []
    let cursor = now
    for (const [start, end] of mergedOpenIntervals) {
      if (start > cursor) neededBlocks.push([cursor, start])
      cursor = Math.max(cursor, end)
    }
    if (cursor < horizonEnd) neededBlocks.push([cursor, horizonEnd])

    const neededKeys = new Set(neededBlocks.map(([start, end]) => `${start}|${end}`))
    const existingByKey = new Map((existingBlocks ?? []).map((row) => [`${Date.parse(row.starts_at)}|${Date.parse(row.ends_at)}`, row]))

    let created = 0
    let removed = 0

    for (const [start, end] of neededBlocks) {
      if (existingByKey.has(`${start}|${end}`)) continue
      const block = await acuity.createBlock({ calendarID: instructor.acuity_calendar_id!, start: new Date(start).toISOString(), end: new Date(end).toISOString(), notes: 'Apollo Lead Manager: nightly reconciliation' })
      await db.from('acuity_blocks').insert({ acuity_block_id: block.id, instructor_id: instructor.id, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), reason: 'reconciliation' })
      created += 1
    }

    for (const [key, row] of existingByKey) {
      if (neededKeys.has(key)) continue
      await acuity.deleteBlock(row.acuity_block_id)
      await db.from('acuity_blocks').delete().eq('id', row.id)
      removed += 1
    }

    summary[instructor.name] = { created, removed }
  }

  return Response.json({ ok: true, summary })
})
