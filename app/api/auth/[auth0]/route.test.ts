import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("/api/auth/*", () => {
  it("answers 503 when Auth0 isn't configured", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "");
    const res = await GET(new NextRequest("http://localhost:3000/api/auth/login"));
    expect(res.status).toBe(503);
  });

  it("answers 404 for a path that isn't an auth route", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "test.example.com");
    vi.stubEnv("AUTH0_CLIENT_ID", "test-client");
    vi.stubEnv("AUTH0_CLIENT_SECRET", "test-secret");
    vi.stubEnv("AUTH0_SECRET", "0".repeat(64));
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    const res = await GET(new NextRequest("http://localhost:3000/api/auth/not-a-route"));
    expect(res.status).toBe(404);
  });
});
