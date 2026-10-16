import { createClient } from '@supabase/supabase-js'
import type { Env } from './env'

// Service-role client for server-side writes. Bypasses grants entirely, which is
// why the migration only grants the client `select` on these tables -- every
// insert/update here is paired with an Acuity or Stripe call using a secret that
// must never reach the browser, so all writes are funneled through these functions.
export function supabaseAdmin(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
