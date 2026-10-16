import type { Env } from './env'
import type { AcuityClient } from './acuityTypes'
import { liveAcuityClient } from './acuity.live'
import { mockAcuityClient } from './acuity.mock'

// Falls back to the mock automatically when there's no API key configured yet,
// so every route below works today and switches to the real Acuity API the
// moment Conor adds ACUITY_USER_ID/ACUITY_API_KEY as Pages secrets -- no code
// change needed. ACUITY_MODE='mock' can also force the mock even once real
// credentials exist, for local testing.
export function getAcuityClient(env: Env): AcuityClient {
  if (env.ACUITY_MODE === 'mock' || !env.ACUITY_USER_ID || !env.ACUITY_API_KEY) return mockAcuityClient()
  return liveAcuityClient(env.ACUITY_USER_ID, env.ACUITY_API_KEY)
}
