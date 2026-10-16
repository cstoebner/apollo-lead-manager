import type { Env } from '../../_shared/env'
import { requireSignedInUser } from '../../_shared/auth'
import { resolveIntake } from '../../_shared/intake'
import { withJsonErrors } from '../../_shared/handler'

// Called from the "Is this the same lead?" card (and the "couldn't read this lead" card).
//   same      -> keep the original lead, add a note to it, send nothing
//   different -> create a new lead and queue its Day 0 email
//   dismiss   -> clear the card without creating anything
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = await requireSignedInUser(context.request, context.env)
  if (authError) return authError
  const { inboundId, decision } = (await context.request.json()) as { inboundId?: string; decision?: 'same' | 'different' | 'dismiss' }
  if (!inboundId || (decision !== 'same' && decision !== 'different' && decision !== 'dismiss')) return Response.json({ error: 'Expected { inboundId, decision }.' }, { status: 400 })
  return Response.json({ ok: true, ...(await resolveIntake(context.env, inboundId, decision)) })
})
