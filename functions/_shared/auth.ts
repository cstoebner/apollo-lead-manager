import type { Env } from './env'
import { supabaseAdmin } from './supabaseAdmin'

// The routes the app itself calls (holds, block sync, fee charges) must only work for a signed-in
// user -- the fee route moves real money, so it can't be a public URL. The browser sends its
// Supabase session token as `Authorization: Bearer <token>`; we verify it with Supabase here.
// (The Acuity/Stripe webhooks and the cron routes have their own signature / shared-secret checks.)
export async function requireSignedInUser(request: Request, env: Env): Promise<Response | null> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ error: 'Sign in required.' }, { status: 401 })
  const { data, error } = await supabaseAdmin(env).auth.getUser(token)
  if (error || !data.user) return Response.json({ error: 'Sign in required.' }, { status: 401 })
  return null
}
