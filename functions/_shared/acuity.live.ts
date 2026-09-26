import type { AcuityAppointment, AcuityAppointmentType, AcuityBlock, AcuityCalendar, AcuityClient } from './acuityTypes'

const BASE_URL = 'https://acuityscheduling.com/api/v1'

class AcuityApiError extends Error {
  constructor(method: string, path: string, status: number, body: string) {
    super(`Acuity ${method} ${path} failed: ${status} ${body}`)
  }
}

export function liveAcuityClient(userId: string, apiKey: string): AcuityClient {
  const authHeader = `Basic ${btoa(`${userId}:${apiKey}`)}`

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await response.text()
    if (!response.ok) throw new AcuityApiError(method, path, response.status, text)
    return text ? (JSON.parse(text) as T) : (undefined as T)
  }

  return {
    listCalendars: () => request<AcuityCalendar[]>('GET', '/calendars'),
    listAppointmentTypes: () => request<AcuityAppointmentType[]>('GET', '/appointment-types'),
    getAppointment: (id) => request<AcuityAppointment>('GET', `/appointments/${id}`),
    listAppointments: ({ minDate, maxDate, calendarID }) => {
      const params = new URLSearchParams({ minDate, maxDate })
      if (calendarID) params.set('calendarID', calendarID)
      return request<AcuityAppointment[]>('GET', `/appointments?${params.toString()}`)
    },
    listBlocks: (calendarID) => request<AcuityBlock[]>('GET', `/blocks?calendarID=${encodeURIComponent(calendarID)}`),
    createBlock: (input) => request<AcuityBlock>('POST', '/blocks', input),
    deleteBlock: async (id) => { await request<void>('DELETE', `/blocks/${id}`) },
    registerWebhook: (input) => request<{ id: string }>('POST', '/webhooks', input),
  }
}

// Verifies the raw (unparsed) webhook body against Acuity's `X-Acuity-Signature`
// header: base64(HMAC-SHA256(rawBody, key=apiKey)). Must run on the raw body --
// re-serializing a parsed form body will not reproduce the same bytes.
export async function verifyAcuitySignature(rawBody: string, signatureHeader: string | null, apiKey: string): Promise<boolean> {
  if (!signatureHeader) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
  return timingSafeEqual(expected, signatureHeader)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
