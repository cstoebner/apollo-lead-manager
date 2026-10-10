import type { Env } from '../_shared/env'
import { requireSignedInUser } from '../_shared/auth'
import { reconcileInstructor } from '../_shared/reconcile'
import { withJsonErrors } from '../_shared/handler'

// "Sync Acuity now" in Settings: runs the same reconciliation as the nightly job for ONE instructor
// (the button calls this once per linked instructor), behind the normal signed-in check.
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = await requireSignedInUser(context.request, context.env)
  if (authError) return authError
  const { instructorId } = (await context.request.json()) as { instructorId: string }
  return Response.json({ ok: true, ...(await reconcileInstructor(context.env, instructorId)) })
})
