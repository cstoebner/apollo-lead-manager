import type { Env } from '../../_shared/env'
import { requireCronSecret } from '../../_shared/cronAuth'
import { linkedInstructors, reconcileInstructor } from '../../_shared/reconcile'
import { withJsonErrors } from '../../_shared/handler'

// Nightly trigger from the companion cron Worker, which asks for the list of linked instructors
// ({ list: true }) and then calls this once per instructor ({ instructorId }) -- each call is its own
// invocation with its own outbound-request budget. The work itself lives in _shared/reconcile.ts, shared
// with the Settings "Sync Acuity now" button (/api/acuity-reconcile).
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = requireCronSecret(context.request, context.env)
  if (authError) return authError
  const body = (await context.request.json().catch(() => ({}))) as { list?: boolean; instructorId?: string }
  if (body.instructorId) return Response.json({ ok: true, ...(await reconcileInstructor(context.env, body.instructorId)) })
  return Response.json({ instructors: await linkedInstructors(context.env) })
})
