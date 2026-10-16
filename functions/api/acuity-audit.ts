import type { Env } from '../_shared/env'
import { requireSignedInUser } from '../_shared/auth'
import { auditAvailability, auditBlocks, auditSetup } from '../_shared/audit'
import { withJsonErrors } from '../_shared/handler'

// Settings -> Acuity sync -> "Run full audit". The page calls this repeatedly (setup, then one request per teacher
// and per teacher + lesson type) so each request stays small. Read-only: nothing is changed in Acuity or Apollo.
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = await requireSignedInUser(context.request, context.env)
  if (authError) return authError
  const body = (await context.request.json()) as { part?: 'setup' | 'blocks' | 'availability'; instructorId?: string; typeId?: string }
  if (body.part === 'setup') return Response.json({ ok: true, ...(await auditSetup(context.env)) })
  if (body.part === 'blocks' && body.instructorId) return Response.json({ ok: true, ...(await auditBlocks(context.env, body.instructorId)) })
  if (body.part === 'availability' && body.instructorId && body.typeId) return Response.json({ ok: true, ...(await auditAvailability(context.env, body.instructorId, body.typeId)) })
  return Response.json({ error: 'Expected { part: "setup" | "blocks" | "availability", instructorId?, typeId? }.' }, { status: 400 })
})
