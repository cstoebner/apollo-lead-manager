import type { Env } from '../../_shared/env'
import { requireCronSecret } from '../../_shared/cronAuth'
import { supabaseAdmin } from '../../_shared/supabaseAdmin'
import { withJsonErrors } from '../../_shared/handler'

// Runs every ~10 min (triggered by the companion cron Worker). Deliberately does
// NOT touch Acuity: per Conor, a slot that was already a flagged Trial Opening
// was never blocked in the first place, and the rare off-schedule exception
// case isn't worth building special re-block-on-expiry logic for -- nightly
// reconciliation already re-blocks anything that should be blocked as part of
// its normal every-night sweep, so this only needs to update our own record.
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = requireCronSecret(context.request, context.env)
  if (authError) return authError

  const db = supabaseAdmin(context.env)
  const { data, error } = await db.from('holds')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('expires_at', new Date().toISOString())
    .select('id')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, expiredCount: data?.length ?? 0 })
})
