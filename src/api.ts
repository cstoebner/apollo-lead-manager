import { supabase } from './supabase'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Calls one of our own Cloudflare Pages Functions (/api/...). Every route the app uses requires the
// signed-in user's Supabase session token; the server verifies it before doing anything.
export async function callApi<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  if (!supabase) throw new ApiError('Not connected to the server.', 0)
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new ApiError('Your session expired — reload the page and sign in again.', 401)
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json: Record<string, unknown> = {}
  try { json = text ? JSON.parse(text) : {} } catch { /* non-JSON error body */ }
  if (!response.ok) throw new ApiError(typeof json.error === 'string' ? json.error : `Request failed (${response.status})`, response.status)
  return json as T
}
