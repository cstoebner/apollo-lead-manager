import type { Env } from './env'

// Same idea as cronAuth: the /api/inbound/lead and /api/inbound/outbox routes are public HTTP endpoints, so the
// Apps Script proves who it is with a shared secret header. Compared in constant time.
export function requireIntakeSecret(request: Request, env: Env): Response | null {
  const provided = request.headers.get('X-Intake-Secret') ?? ''
  const expected = env.INTAKE_SECRET ?? ''
  let diff = provided.length ^ expected.length
  for (let i = 0; i < Math.min(provided.length, expected.length); i += 1) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  if (!expected || diff !== 0) return new Response('Unauthorized', { status: 401 })
  return null
}
