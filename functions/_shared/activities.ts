import type { supabaseAdmin } from './supabaseAdmin'

// activities.owner_id is NOT NULL and normally defaults to the signed-in user (auth.uid()). The service-role key
// used by server routes has no signed-in user, so every server-side insert has to carry the lead's owner explicitly.
export async function addActivity(db: ReturnType<typeof supabaseAdmin>, leadId: string, type: string, outcome: string, occurredAt = new Date().toISOString()) {
  const { data: lead, error: leadError } = await db.from('leads').select('owner_id').eq('id', leadId).single()
  if (leadError || !lead) throw new Error(`Could not find the lead to log this on: ${leadError?.message ?? 'not found'}`)
  const { data, error } = await db.from('activities').insert({ lead_id: leadId, owner_id: lead.owner_id, type, occurred_at: occurredAt, outcome }).select('id').single()
  if (error) throw new Error(`Could not log the activity: ${error.message}`)
  return { id: data.id as string, type, occurredAt, outcome }
}
