import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Auth0 sign-in for the console. The SDK's routes live under /api/auth/ (Role 2's
// folder), handled by app/api/auth/[auth0]/route.ts, so the app needs no root proxy.

/** The token claim the post-login Action "Refill Guard role claim" sets from app_metadata.role. */
export const ROLE_CLAIM = "https://refill-guard/role";

export const AUTH_ROUTES = {
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  callback: "/api/auth/callback",
  profile: "/api/auth/profile",
  accessToken: "/api/auth/access-token",
  backChannelLogout: "/api/auth/backchannel-logout",
} as const;

const KEPT_CLAIMS = new Set(["sub", "name", "nickname", "email", "email_verified", "picture", ROLE_CLAIM]);

/** The session keeps the standard profile claims plus our role claim, nothing else. */
export function keepClaims<T extends Record<string, unknown>>(user: T): Partial<T> {
  return Object.fromEntries(Object.entries(user).filter(([key]) => KEPT_CLAIMS.has(key))) as Partial<T>;
}

const REQUIRED_ENV = ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"];

export function auth0Configured(): boolean {
  return REQUIRED_ENV.every((name) => Boolean(process.env[name]));
}

const holder = globalThis as typeof globalThis & { __refillGuardAuth0?: Auth0Client };

/** The server's Auth0 client, or null when the keys aren't in .env (then nobody can sign in). */
export function getAuth0(): Auth0Client | null {
  if (!auth0Configured()) return null;
  holder.__refillGuardAuth0 ??= new Auth0Client({
    routes: AUTH_ROUTES,
    signInReturnToPath: "/console/today",
    authorizationParameters: { scope: "openid profile email" },
    // Without this hook the SDK drops every non-standard claim, including the role.
    beforeSessionSaved: async (session) => ({ ...session, user: keepClaims(session.user) as typeof session.user }),
  });
  return holder.__refillGuardAuth0;
}
