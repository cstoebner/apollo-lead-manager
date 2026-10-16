import type { Env } from '../_shared/env'
import { getAcuityClient } from '../_shared/acuityClient'
import { withJsonErrors } from '../_shared/handler'
import { requireSignedInUser } from '../_shared/auth'

// Lists the calendars in Acuity (one per instructor) so the app can link an instructor to theirs.
export const onRequestPost: PagesFunction<Env> = withJsonErrors(async (context) => {
  const authError = await requireSignedInUser(context.request, context.env)
  if (authError) return authError
  const calendars = await getAcuityClient(context.env).listCalendars()
  return Response.json({ ok: true, calendars: calendars.map((calendar) => ({ id: String(calendar.id), name: calendar.name })) })
})
