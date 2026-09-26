import type { StripeChargeResult, StripeClient } from './stripeTypes'

let nextPaymentIntentId = 1
const seenIdempotencyKeys = new Map<string, StripeChargeResult>()

export function mockStripeClient(): StripeClient {
  return {
    async findCustomerAndPaymentMethod(email) {
      return { customerId: `cus_mock_${email}`, paymentMethodId: 'pm_mock_card' }
    },
    async createOffSessionCharge({ idempotencyKey }): Promise<StripeChargeResult> {
      const existing = seenIdempotencyKeys.get(idempotencyKey)
      if (existing) return existing
      const result: StripeChargeResult = { status: 'succeeded', paymentIntentId: `pi_mock_${nextPaymentIntentId++}` }
      seenIdempotencyKeys.set(idempotencyKey, result)
      return result
    },
  }
}
