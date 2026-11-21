// Small helpers shared by the /api routes. Every error has the same shape:
// { error: string }, with a matching HTTP status.

export function ok(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/** Read a JSON object body. Returns null if the body is missing, not JSON, or not an object. */
export async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** For endpoints whose real work belongs to a later task. Says which one. */
export function notBuilt(task: string): Response {
  return fail(501, `Not built yet: ${task}`);
}
