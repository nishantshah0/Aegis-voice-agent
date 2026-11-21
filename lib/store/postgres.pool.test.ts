import { describe, expect, it } from "vitest";
import { poolConfig } from "./postgres";

describe("poolConfig (2.7, Tiger Data)", () => {
  it("always verifies the server certificate, and drops sslmode from the URL so pg can't override that", () => {
    const config = poolConfig("postgres://u:p@db.example.com:5432/tsdb?sslmode=require");
    expect(config.connectionString).toBe("postgres://u:p@db.example.com:5432/tsdb");
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("trusts a given CA (Tiger Data's ca.pem) in addition, still verifying", () => {
    const config = poolConfig("postgres://u:p@db.example.com:5432/tsdb?sslmode=require&application_name=rg", "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n");
    expect(config.connectionString).toBe("postgres://u:p@db.example.com:5432/tsdb?application_name=rg");
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n" });
  });
});
