export interface StripeCustomerMatch {
  customerId: string
  paymentMethodId: string
}

export interface StripeChargeResult {
  status: 'succeeded' | 'failed'
  paymentIntentId?: string
  failureMessage?: string
}

export interface StripeClient {
  findCustomerAndPaymentMethod(email: string): Promise<StripeCustomerMatch | null>
  createOffSessionCharge(input: {
    customerId: string
    paymentMethodId: string
    amountCents: number
    description: string
    idempotencyKey: string
    metadata: Record<string, string>
  }): Promise<StripeChargeResult>
}
