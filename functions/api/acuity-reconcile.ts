import type { Env } from '../_shared/env'
import { requireSignedInUser } from '../_shared/auth'
import { reconcileAcuity } from '../_shared/reconcile'
import { withJsonErrors } from '../_shared/handler'

// "Sync Acuity now" in Settings: runs the same reconciliation as the nightly job, behind the normal
// signed-in-user check instead of the cron secret.
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = await requireSignedInUser(context.request, context.env)
  if (authError) return authError
  return Response.json(await reconcileAcuity(context.env))
})
