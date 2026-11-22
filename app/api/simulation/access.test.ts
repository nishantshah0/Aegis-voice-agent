import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { simulationAccessRefused } from "./access";

const origin = "https://presenter.example.invalid";
const secret = "fixture-only-secret-for-the-isolated-policy-test";
const path = "/api/simulation/live";
const proof = { host: "presenter.example.invalid", "x-forwarded-host": "presenter.example.invalid", "x-forwarded-proto": "https", "x-aegis-presenter": secret };
const request = (url: string, method: string, headers: HeadersInit = {}) => new Request(url, { method, headers });

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("PATIENT_SIMULATION", "community-demo");
  vi.stubEnv("AEGIS_PUBLIC_ORIGIN", origin);
  vi.stubEnv("AEGIS_PRESENTER_SECRET", secret);
});
afterEach(() => vi.unstubAllEnvs());

describe("synthetic simulation presenter boundary", () => {
  it("accepts the authenticated proxy on all three exact routes, including an internal HTTP hop", () => {
    for (const [method, endpoint] of [["POST", path], ["GET", path + "/latest"], ["POST", "/api/simulation/speak"]]) {
      const headers = method === "GET" ? proof : { ...proof, origin };
      expect(simulationAccessRefused(request("http://127.0.0.1:3000" + endpoint, method, headers))).toBeNull();
    }
  });

  it("rejects an incorrect origin, missing proof, untrusted forwarded metadata, or unrelated path", () => {
    for (const extra of [
      { origin: "https://other.example.invalid" }, { origin: "" }, { "x-aegis-presenter": "" },
      { "x-aegis-presenter": secret + "bad" }, { host: "unrelated.invalid" }, { "x-forwarded-host": "localhost:3000" },
      { "x-forwarded-proto": "http" }, { "sec-fetch-site": "cross-site" },
    ]) {
      expect(simulationAccessRefused(request(origin + path, "POST", { ...proof, origin, ...extra } as Record<string,string>))?.status).toBe(403);
    }
    expect(simulationAccessRefused(request(origin + "/api/other", "POST", { ...proof, origin }))?.status).toBe(403);
  });

  it("never enables the loopback shortcut for a hosted or partially configured deployment", () => {
    const local = request("http://localhost:3000" + path, "POST");
    expect(simulationAccessRefused(local)?.status).toBe(403);
    vi.stubEnv("AEGIS_PRESENTER_SECRET", "");
    expect(simulationAccessRefused(local)?.status).toBe(403);
    vi.stubEnv("AEGIS_PUBLIC_ORIGIN", "");
    expect(simulationAccessRefused(local)).toBeNull();
  });

  it("requires the exact configured HTTPS origin, a strong configured secret, and isolated synthetic data", () => {
    const req = request(origin + path, "POST", { ...proof, origin });
    for (const configured of ["https://presenter.example.invalid/path", "http://presenter.example.invalid", "https://user@presenter.example.invalid"]) {
      vi.stubEnv("AEGIS_PUBLIC_ORIGIN", configured);
      expect(simulationAccessRefused(req)?.status).toBe(403);
    }
    vi.stubEnv("AEGIS_PUBLIC_ORIGIN", origin);
    vi.stubEnv("AEGIS_PRESENTER_SECRET", "short");
    expect(simulationAccessRefused(req)?.status).toBe(403);
    vi.stubEnv("AEGIS_PRESENTER_SECRET", secret);
    vi.stubEnv("DATABASE_URL", "mock-configured");
    expect(simulationAccessRefused(req)?.status).toBe(403);
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PATIENT_SIMULATION", "other");
    expect(simulationAccessRefused(req)?.status).toBe(403);
  });
});
