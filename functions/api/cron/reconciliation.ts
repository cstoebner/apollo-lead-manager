import type { Env } from '../../_shared/env'
import { requireCronSecret } from '../../_shared/cronAuth'
import { reconcileAcuity } from '../../_shared/reconcile'
import { withJsonErrors } from '../../_shared/handler'

// Nightly trigger from the companion cron Worker. The actual work lives in _shared/reconcile.ts so the
// Settings "Sync Acuity now" button (/api/acuity-reconcile) can run exactly the same thing on demand.
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = requireCronSecret(context.request, context.env)
  if (authError) return authError
  return Response.json(await reconcileAcuity(context.env))
})
