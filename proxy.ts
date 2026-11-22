import { NextResponse, type NextRequest } from "next/server";
import { AUTH_ROUTES, getAuth0 } from "@/lib/auth/auth0";
import { approverFromUser } from "@/lib/auth/session";

// Sign-in for the whole signed-in app (/app), checked before any page or layout renders,
// so nothing from the store or results/ streams to a signed-out browser. Fails closed:
// with no Auth0 keys, or an unreadable session, every /app request goes to sign-in.
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const auth0 = getAuth0();
  const session = auth0 ? await auth0.getSession(request).catch(() => null) : null;
  if (approverFromUser(session?.user)) return NextResponse.next();

  // Signed in, but with no pharmacist or reviewer role: sending them to sign in again would loop,
  // so they get a page that says so, with sign-out (AUDIT #11).
  if (session?.user) return NextResponse.redirect(new URL("/no-access", request.url));

  const login = new URL(AUTH_ROUTES.login, request.url);
  login.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/app", "/app/:path*"],
};
