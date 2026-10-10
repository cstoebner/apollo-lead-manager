export interface Env {
  APP_BASE_URL: string
  CRON_SECRET: string
}

async function callCronRoute<T = unknown>(env: Env, path: string, body?: unknown): Promise<T | null> {
  const response = await fetch(`${env.APP_BASE_URL}${path}`, { method: 'POST', headers: { 'X-Cron-Secret': env.CRON_SECRET, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  if (!response.ok) { console.error(`${path} failed: ${response.status} ${await response.text()}`); return null }
  return (await response.json()) as T
}

// Reconciliation runs one instructor per request: Cloudflare caps each invocation at 50 outbound requests,
// and a whole studio's worth of Acuity/Supabase calls in one go exceeds that.
async function reconcileEveryone(env: Env) {
  const list = await callCronRoute<{ instructors: { id: string; name: string }[] }>(env, '/api/cron/reconciliation', { list: true })
  for (const instructor of list?.instructors ?? []) {
    const result = await callCronRoute(env, '/api/cron/reconciliation', { instructorId: instructor.id })
    console.log(`Reconciled ${instructor.name}: ${JSON.stringify(result)}`)
  }
}

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(event.cron === '0 8 * * *' ? reconcileEveryone(env) : callCronRoute(env, '/api/cron/hold-expiry'))
  },
}
