// Wraps a route handler so any unexpected throw (a network hiccup, malformed
// body, etc.) comes back as a clean JSON 500 instead of whatever the platform's
// own generic error page looks like -- every route below uses this.
export function withJsonErrors<Env>(handler: PagesFunction<Env>): PagesFunction<Env> {
  return async (context) => {
    try {
      return await handler(context)
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
    }
  }
}
