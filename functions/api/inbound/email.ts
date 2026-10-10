import type { Env } from '../../_shared/env'
import { requireSignedInUser } from '../../_shared/auth'
import { supabaseAdmin } from '../../_shared/supabaseAdmin'
import { refreshDraftEmails } from '../../_shared/intake'
import { withJsonErrors } from '../../_shared/handler'

// Draft review.
//   refresh  -> re-read the schedule and rewrite the draft(s) (all drafts, or just { emailId }) so the preview
//               shows the openings that exist right now
//   approve  -> refresh it one last time, then queue it for the Gmail script to send (also retries a failed send)
//   discard  -> drop it
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = await requireSignedInUser(context.request, context.env)
  if (authError) return authError
  const { emailId, action } = (await context.request.json()) as { emailId?: string; action?: 'approve' | 'discard' | 'refresh' }

  if (action === 'refresh') return Response.json({ ok: true, emails: await refreshDraftEmails(context.env, emailId ? [emailId] : undefined) })

  if (!emailId || (action !== 'approve' && action !== 'discard')) return Response.json({ error: 'Expected { emailId, action }.' }, { status: 400 })
  if (action === 'approve') {
    try { await refreshDraftEmails(context.env, [emailId]) } catch (error) { console.warn('Refresh before approving failed:', error) } // best effort: fall back to the draft as shown
  }
  const db = supabaseAdmin(context.env)
  const allowed = action === 'approve' ? ['draft', 'failed'] : ['draft', 'failed', 'queued']
  const { data, error } = await db.from('outbound_emails')
    .update({ status: action === 'approve' ? 'queued' : 'discarded', error: null })
    .eq('id', emailId).in('status', allowed).select('id, status')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data?.length) return Response.json({ error: 'That email can no longer be changed (it may already be sending or sent).' }, { status: 409 })
  return Response.json({ ok: true, status: data[0].status })
})
