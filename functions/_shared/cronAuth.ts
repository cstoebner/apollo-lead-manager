import type { Env } from './env'

// The two /api/cron/* routes are ordinary public HTTP endpoints (Pages Functions
// have no built-in scheduled() support), triggered by a small companion Worker
// (see cron-worker/) on a real Cron Trigger. This header is how we make sure a
// stranger who finds the URL can't fire hold-expiry or reconciliation themselves.
export function requireCronSecret(request: Request, env: Env): Response | null {
  const provided = request.headers.get('X-Cron-Secret')
  if (!env.CRON_SECRET || provided !== env.CRON_SECRET) return new Response('Unauthorized', { status: 401 })
  return null
}
