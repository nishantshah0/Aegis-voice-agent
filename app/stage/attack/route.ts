import { randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after } from "next/server";
import { emit } from "@/lib/events";
import { SEED } from "@/lib/seed";
import { demoControlsRefused } from "../../api/_lib/demo";
import { fail, ok, readObject } from "../../api/_lib/http";
import { hijackRunning } from "../../api/arena/hijack/run";
import { parsePick } from "../attacks";
import { runStageAttack } from "../attack-run";

// POST /stage/attack { card } or { text } → 202 { started: true }
// Runs one attack the judge picked, slowly, through the real lock; the stage follows it
// through press and blocked_line events. Same access as the hijack batch: staff, or
// DEMO_CONTROLS=on. 409 while an attack or a batch is running.

const STEP_MS = 1100;
const holder = globalThis as typeof globalThis & { __aegisStageAttackRunning?: boolean };
const resultsDir = () => process.env.RESULTS_DIR ?? join(process.cwd(), "results");

export async function POST(request: Request) {
  const refused = await demoControlsRefused();
  if (refused) return refused;
  const pick = parsePick(await readObject(request));
  if (!pick) return fail(400, "Pick an attack card, or type up to 200 characters");
  if (holder.__aegisStageAttackRunning || hijackRunning()) return fail(409, "An attack is already running");
  holder.__aegisStageAttackRunning = true;
  after(async () => {
    try {
      const runDir = join(resultsDir(), "hijack", `pick-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      await mkdir(runDir, { recursive: true });
      await runStageAttack(pick, {
        seed: SEED,
        code: String(randomInt(0, 1_000_000)).padStart(6, "0"),
        emit,
        saveResult: (run) => writeFile(join(runDir, `${run.tag}.json`), JSON.stringify(run, null, 2)),
        pause: () => new Promise((resolve) => setTimeout(resolve, STEP_MS)),
      });
    } catch (error) {
      console.error("stage attack failed", error);
    } finally {
      holder.__aegisStageAttackRunning = false;
    }
  });
  return ok({ started: true }, 202);
}
