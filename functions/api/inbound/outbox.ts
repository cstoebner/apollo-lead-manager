import type { Env } from '../../_shared/env'
import { requireIntakeSecret } from '../../_shared/intakeAuth'
import { supabaseAdmin } from '../../_shared/supabaseAdmin'
import { withJsonErrors } from '../../_shared/handler'

const MAX_PER_PULL = 5
const STUCK_AFTER_MS = 10 * 60_000

// The Apps Script drains the email queue through this route, once a minute:
//   { action: 'pull' }                -> up to 5 approved emails, now marked 'sending'
//   { action: 'sent', id }            -> it went out; log it on the lead
//   { action: 'failed', id, error }   -> mark failed so it shows up for a retry/review
// The email itself is sent by the script from Gmail (so it comes from Conor's own address).
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = requireIntakeSecret(context.request, context.env)
  if (authError) return authError
  const body = (await context.request.json()) as { action?: string; id?: string; error?: string }
  const db = supabaseAdmin(context.env)

  if (body.action === 'pull') {
    // A script run that died after 'pull' leaves rows stuck in 'sending'; hand them out again after a while.
    await db.from('outbound_emails').update({ status: 'queued' }).eq('status', 'sending').lt('picked_at', new Date(Date.now() - STUCK_AFTER_MS).toISOString())
    const { data: candidates, error } = await db.from('outbound_emails').select('id').eq('status', 'queued').order('created_at', { ascending: true }).limit(MAX_PER_PULL)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const ids = (candidates ?? []).map((row) => row.id)
    if (!ids.length) return Response.json({ ok: true, emails: [] })
    // Claim them in one statement that only matches rows still 'queued', so two overlapping script runs can never
    // both receive (and both send) the same email.
    const { data: claimed, error: claimError } = await db.from('outbound_emails')
      .update({ status: 'sending', picked_at: new Date().toISOString() })
      .in('id', ids).eq('status', 'queued')
      .select('id, to_email, subject, text_body, html_body')
    if (claimError) return Response.json({ error: claimError.message }, { status: 500 })
    return Response.json({ ok: true, emails: (claimed ?? []).map((row) => ({ id: row.id, to: row.to_email, subject: row.subject, text: row.text_body, html: row.html_body })) })
  }

  if (!body.id) return Response.json({ error: 'Missing id.' }, { status: 400 })
  const { data: email } = await db.from('outbound_emails').select('id, lead_id, subject, proposed_times, status').eq('id', body.id).single()
  if (!email) return Response.json({ error: 'Email not found.' }, { status: 404 })

  if (body.action === 'sent') {
    if (email.status === 'sent') return Response.json({ ok: true, alreadyLogged: true })
    await db.from('outbound_emails').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }).eq('id', email.id)
    const times = ((email.proposed_times ?? []) as { label: string }[]).map((time) => time.label)
    await db.from('activities').insert({
      lead_id: email.lead_id, type: 'email', occurred_at: new Date().toISOString(),
      outcome: `Day 0 email sent — "${email.subject}"${times.length ? ` · offered ${times.join(' and ')}` : ''} · with a Book now link`,
    })
    return Response.json({ ok: true })
  }
  if (body.action === 'failed') {
    await db.from('outbound_emails').update({ status: 'failed', error: (body.error ?? 'Unknown error').slice(0, 500) }).eq('id', email.id)
    return Response.json({ ok: true })
  }
  return Response.json({ error: 'Unknown action.' }, { status: 400 })
})
