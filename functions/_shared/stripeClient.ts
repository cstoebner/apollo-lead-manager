import type { Env } from './env'
import type { StripeClient } from './stripeTypes'
import { liveStripeClient } from './stripe.live'
import { mockStripeClient } from './stripe.mock'

export function getStripeClient(env: Env): StripeClient {
  if (env.STRIPE_MODE === 'mock' || !env.STRIPE_SECRET_KEY) return mockStripeClient()
  return liveStripeClient(env.STRIPE_SECRET_KEY)
}
