import { connection, type NextRequest } from "next/server";
import { AUTH_ROUTES, getAuth0 } from "@/lib/auth/auth0";
import { fail } from "../../_lib/http";

// /api/auth/login, /logout, /callback, /profile, /access-token, /backchannel-logout.
// The Auth0 SDK does the work; this route only mounts it inside app/api.
const KNOWN = new Set<string>(Object.values(AUTH_ROUTES));

async function handle(request: NextRequest): Promise<Response> {
  await connection();
  const auth0 = getAuth0();
  if (!auth0) return fail(503, "Auth0 isn't configured on this server");
  if (!KNOWN.has(request.nextUrl.pathname.replace(/\/$/, ""))) return fail(404, "No such auth route");
  return auth0.middleware(request);
}

export const GET = handle;
export const POST = handle;
