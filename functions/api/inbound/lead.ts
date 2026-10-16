import type { Env } from '../../_shared/env'
import { requireIntakeSecret } from '../../_shared/intakeAuth'
import { processIntake, type IntakeInput } from '../../_shared/intake'
import { withJsonErrors } from '../../_shared/handler'

// The Apps Script calls this once per new Meta lead row / Formspree email. Idempotent on externalId, so the
// script can safely retry. Returns what happened so the script can log it.
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = requireIntakeSecret(context.request, context.env)
  if (authError) return authError
  const body = (await context.request.json()) as Partial<IntakeInput>
  if ((body.source !== 'meta' && body.source !== 'formspree') || !body.externalId || typeof body.fields !== 'object' || !body.fields) {
    return Response.json({ error: 'Expected { source: "meta" | "formspree", externalId, fields }.' }, { status: 400 })
  }
  return Response.json({ ok: true, ...(await processIntake(context.env, { source: body.source, externalId: String(body.externalId), receivedAt: body.receivedAt, fields: body.fields })) })
})
