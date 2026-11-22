// Every /app page needs a signed-in pharmacist or reviewer, checked before anything renders.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const PAGES = ["/app", "/app/pharmacy/today", "/app/safety/scenarios"];

async function signedOut(path: string) {
  const { proxy } = await import("./proxy");
  return proxy(new NextRequest(`http://localhost:3000${path}`));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("proxy: sign-in before any /app page", () => {
  it("runs on /app and everything under it, and nowhere else", async () => {
    const { config } = await import("./proxy");
    expect(config.matcher).toEqual(["/app", "/app/:path*"]);
  });

  it("redirects a signed-out request to Auth0 with no page data, when Auth0 isn't configured", async () => {
    for (const path of PAGES) {
      const res = await signedOut(path);
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/api/auth/login");
      expect(location.searchParams.get("returnTo")).toBe(path);
      expect(await res.text()).toBe("");
    }
  });

  it("redirects a request with no session cookie, when Auth0 is configured", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "example.auth0.com");
    vi.stubEnv("AUTH0_CLIENT_ID", "test-client");
    vi.stubEnv("AUTH0_CLIENT_SECRET", "test-secret");
    vi.stubEnv("AUTH0_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    for (const path of ["/app/pharmacy/today", "/app/safety/scenarios"]) {
      const res = await signedOut(path);
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/api/auth/login");
      expect(await res.text()).toBe("");
    }
  });
});
