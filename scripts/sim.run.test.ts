import { describe, expect, it } from "vitest";
import { main } from "./sim";

// The entry for scripts/sim.ts. Opt in, since it writes results/sim/<run>/:
//   SIM=1 npx vitest run scripts/sim.run.test.ts
describe.skipIf(process.env.SIM !== "1")("outreach simulation run", () => {
  it("runs and saves to results/sim/<run>/", { timeout: 300_000 }, async () => {
    expect(await main()).toContain("results/sim/");
  });
});
