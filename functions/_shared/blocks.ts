import type { AcuityClient } from './acuityTypes'
import type { supabaseAdmin } from './supabaseAdmin'

export type BlockRange = { starts_at: string; ends_at: string }

// The pieces of a block that remain after carving [start, end) out of it. Reconciliation creates big blocks
// (e.g. "now until the next opening", "after it until 90 days out"), so opening ONE slot must not delete a
// whole block -- that would open every time in its range to the public.
export function remainingPieces(block: BlockRange, start: Date, end: Date): { start: Date; end: Date }[] {
  const blockStart = new Date(block.starts_at)
  const blockEnd = new Date(block.ends_at)
  const pieces: { start: Date; end: Date }[] = []
  if (blockStart < start) pieces.push({ start: blockStart, end: new Date(Math.min(blockEnd.getTime(), start.getTime())) })
  if (blockEnd > end) pieces.push({ start: new Date(Math.max(blockStart.getTime(), end.getTime())), end: blockEnd })
  return pieces
}

// Opens [start, end) on an instructor's Acuity calendar by splitting any tracked block that covers it.
// Remainders are created BEFORE the original is deleted, so a failure part-way leaves the page more blocked,
// never accidentally wide open.
export async function openWindow(
  db: ReturnType<typeof supabaseAdmin>,
  acuity: AcuityClient,
  instructor: { id: string; acuity_calendar_id: string },
  start: Date,
  end: Date,
) {
  const { data: overlapping } = await db.from('acuity_blocks')
    .select('id, acuity_block_id, starts_at, ends_at')
    .eq('instructor_id', instructor.id)
    .lt('starts_at', end.toISOString())
    .gt('ends_at', start.toISOString())
  for (const block of overlapping ?? []) {
    for (const piece of remainingPieces(block, start, end)) {
      const created = await acuity.createBlock({ calendarID: instructor.acuity_calendar_id, start: piece.start.toISOString(), end: piece.end.toISOString(), notes: 'Apollo Lead Manager: split around an open slot' })
      await db.from('acuity_blocks').insert({ acuity_block_id: created.id, instructor_id: instructor.id, starts_at: piece.start.toISOString(), ends_at: piece.end.toISOString(), reason: 'split' })
    }
    await acuity.deleteBlock(block.acuity_block_id)
    await db.from('acuity_blocks').delete().eq('id', block.id)
  }
}
