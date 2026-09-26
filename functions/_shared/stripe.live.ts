import type { StripeChargeResult, StripeClient, StripeCustomerMatch } from './stripeTypes'

const BASE_URL = 'https://api.stripe.com/v1'

function toFormBody(fields: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    params.set(key, String(value))
  }
  return params.toString()
}

export function liveStripeClient(secretKey: string): StripeClient {
  const authHeader = `Bearer ${secretKey}`

  async function request(method: string, path: string, body?: string, idempotencyKey?: string) {
    const headers: Record<string, string> = { Authorization: authHeader, 'Content-Type': 'application/x-www-form-urlencoded' }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    const response = await fetch(`${BASE_URL}${path}`, { method, headers, body })
    const json = (await response.json()) as any
    return { ok: response.ok, json }
  }

  return {
    async findCustomerAndPaymentMethod(email) {
      const { ok, json } = await request('GET', `/customers?${toFormBody({ email, limit: 1 })}`)
      const customer = ok ? json.data?.[0] : undefined
      if (!customer) return null

      const defaultPaymentMethod: string | undefined = customer.invoice_settings?.default_payment_method ?? customer.default_source ?? undefined
      if (defaultPaymentMethod) return { customerId: customer.id, paymentMethodId: defaultPaymentMethod }

      // No default set explicitly -- fall back to their most recently attached card.
      const paymentMethods = await request('GET', `/payment_methods?${toFormBody({ customer: customer.id, type: 'card', limit: 1 })}`)
      const paymentMethodId = paymentMethods.ok ? paymentMethods.json.data?.[0]?.id : undefined
      return paymentMethodId ? { customerId: customer.id, paymentMethodId } : null
    },

    async createOffSessionCharge({ customerId, paymentMethodId, amountCents, description, idempotencyKey, metadata }): Promise<StripeChargeResult> {
      const metadataFields = Object.fromEntries(Object.entries(metadata).map(([key, value]) => [`metadata[${key}]`, value]))
      const body = toFormBody({
        amount: amountCents,
        currency: 'usd',
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description,
        ...metadataFields,
      })
      const { ok, json } = await request('POST', '/payment_intents', body, idempotencyKey)
      if (ok && json.status === 'succeeded') return { status: 'succeeded', paymentIntentId: json.id }
      const failureMessage: string = json.error?.message ?? `Unexpected Stripe status: ${json.status ?? 'unknown'}`
      const paymentIntentId: string | undefined = json.error?.payment_intent?.id ?? json.id
      return { status: 'failed', paymentIntentId, failureMessage }
    },
  }
}

// Verifies Stripe's `Stripe-Signature` header: "t=<timestamp>,v1=<hex hmac>" where
// the hmac is HMAC-SHA256(`${timestamp}.${rawBody}`, webhookSecret). Must run on
// the raw body. Rejects signatures older than 5 minutes to block replay.
export async function verifyStripeSignature(rawBody: string, signatureHeader: string | null, webhookSecret: string): Promise<boolean> {
  if (!signatureHeader) return false
  const parts = Object.fromEntries(signatureHeader.split(',').map((part) => part.split('=') as [string, string]))
  const timestamp = parts.t
  const signature = parts.v1
  if (!timestamp || !signature) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(webhookSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`))
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return timingSafeEqual(expected, signature)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
