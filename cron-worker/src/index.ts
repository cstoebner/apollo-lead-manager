export interface Env {
  APP_BASE_URL: string
  CRON_SECRET: string
}

async function callCronRoute(env: Env, path: string): Promise<void> {
  const response = await fetch(`${env.APP_BASE_URL}${path}`, { method: 'POST', headers: { 'X-Cron-Secret': env.CRON_SECRET } })
  if (!response.ok) console.error(`${path} failed: ${response.status} ${await response.text()}`)
}

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const path = event.cron === '0 8 * * *' ? '/api/cron/reconciliation' : '/api/cron/hold-expiry'
    ctx.waitUntil(callCronRoute(env, path))
  },
}
