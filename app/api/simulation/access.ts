import { createHash, timingSafeEqual } from "node:crypto";
import { fail } from "../_lib/http";

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const presenterRoutes = new Map([
  ["/api/simulation/live", "POST"],
  ["/api/simulation/live/latest", "GET"],
  ["/api/simulation/speak", "POST"],
]);

function publicOrigin(configured?: string): URL | undefined {
  if (!configured) return;
  try {
    const url = new URL(configured);
    // An origin has no credentials, path, query or fragment.
    if (url.protocol === "https:" && configured === url.origin) return url;
  } catch { /* An invalid deployment configuration denies access. */ }
}

/** The gateway authenticates the presenter and replaces any client-supplied proof. */
function presenterAllowed(request: Request, url: URL, configured?: string, secret?: string): boolean {
  const expected = publicOrigin(configured);
  if (!expected || !secret || Buffer.byteLength(secret) < 32 || presenterRoutes.get(url.pathname) !== request.method) return false;
  const host = request.headers.get("host") ?? url.host;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (host !== expected.host || (forwardedHost !== null && forwardedHost !== expected.host)) return false;
  if (forwardedProto !== null && forwardedProto !== "https") return false;
  // Next may reconstruct request.url from its local listener. In that case
  // require the gateway's HTTPS metadata and the exact external Host above.
  if (url.origin !== expected.origin && !((loopback.has(url.hostname) || url.host === expected.host) && forwardedProto === "https")) return false;
  const origin = request.headers.get("origin");
  if ((request.method === "POST" || origin !== null) && origin !== expected.origin) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const given = request.headers.get("x-aegis-presenter");
  if (!given) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

export function simulationAccessRefused(request: Request): Response | null {
  if (process.env.DATABASE_URL || process.env.PATIENT_SIMULATION !== "community-demo") {
    return fail(403, "Live tests require the isolated synthetic demo.");
  }
  const url = new URL(request.url);
  const configured = process.env.AEGIS_PUBLIC_ORIGIN;
  const secret = process.env.AEGIS_PRESENTER_SECRET;
  if (configured || secret) {
    return presenterAllowed(request, url, configured, secret) ? null : fail(403, "Presenter access is required for the hosted simulation.");
  }
  const host = request.headers.get("host") ?? url.host;
  const origin = request.headers.get("origin");
  const forwarded = request.headers.get("x-forwarded-host");
  if (!loopback.has(url.hostname) || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)
      || (forwarded && forwarded !== host)
      || (origin && origin !== url.protocol + "//" + host)
      || request.headers.get("sec-fetch-site") === "cross-site") {
    return fail(403, "Open the local simulation or sign in to the presenter gateway.");
  }
  return null;
}
