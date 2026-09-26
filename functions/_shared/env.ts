// Cloudflare Pages Functions binding shape. Real values are set as encrypted
// secrets in the Pages project dashboard (Settings -> Environment variables) --
// never committed, never shipped to the browser bundle.
export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string

  // Acuity. Left unset (or ACUITY_MODE='mock') until Conor has real credentials --
  // acuityClient.ts falls back to the in-memory mock automatically when the API
  // key is missing, so the rest of the app can be built and tested without them.
  ACUITY_USER_ID?: string
  ACUITY_API_KEY?: string
  ACUITY_SCHEDULER_ID?: string
  ACUITY_APPOINTMENT_TYPE_ID?: string
  ACUITY_MODE?: 'live' | 'mock'

  // Stripe. Same fallback-to-mock behavior as Acuity above.
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_MODE?: 'live' | 'mock'

  // Shared secret the companion cron Worker sends on every scheduled call, so
  // the two /api/cron/* routes can't be triggered by a stranger who finds the URL.
  CRON_SECRET: string
}
