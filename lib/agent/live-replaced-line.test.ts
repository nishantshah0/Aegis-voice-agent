// 1.2 live: the agent must not apologise for a line the guard replaced.
//
// Demo pass 14 (ROLE-0's REQUEST at 20:59): after S4 replaced a sentence, the
// live agent's next turn opened with "I'm sorry, I should correct what I said a
// moment ago." The caller never heard the original, so the apology invents a
// mistake for them, and a judge watching the call sees something go wrong.
//
// driver.replaced-line.test.ts pins the note the model is given. This checks what
// a real model does with it, which is the part a scripted model cannot tell us.
//
// Skipped unless LIVE_AGENT=1; runs on this machine's Claude Code login, so no
// ANTHROPIC_API_KEY is involved.
//   LIVE_AGENT=1 npx vitest run lib/agent/live-replaced-line.test.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@/lib/contract";
import { createControl } from "@/lib/control";
import { createSafetyCheck, createSpeechGuard } from "@/lib/guard";
import { IDS, SEED } from "@/lib/seed";
import { createMemoryStore } from "@/lib/store/memory";

import { createAgentSdkModel } from "./agent-sdk";
import { createAgentDriver } from "./driver";

const LIVE = process.env.LIVE_AGENT === "1";
const CODE = "135791";
/** check_code verifies only with the date of birth too, so S1 would block otherwise. */
const SAM_DOB = SEED.patients.find((p) => p.id === IDS.sam)!.dob;
/** S4 blocks this while the refill is still waiting on a pharmacist. */
const FALSE_PROMISE = "Your Concerta refill is approved.";

/**
 * Any apology, not just pass 14's wording. The first version of this listed
 * phrases like "i'm sorry" and "misspoke", and a live run walked straight
 * through it with "Sorry about that." A narrow pattern here is worse than none,
 * because it passes while the thing it guards against is happening.
 */
const APOLOGY = /\b(sorry|apolog|misspoke|my (mistake|error)|i was wrong|let me correct|i should correct)\b/i;

/**
 * A neutral prompt to carry on. "Sorry, what was that?" invites an apology, so
 * the earlier version of this test was asking for the behaviour it then measured.
 */
const CARRY_ON = "Right, go on.";

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

describe.skipIf(!LIVE)("1.2 live: a replaced line is not mentioned on the call", () => {
  it(
    "carries on from what the caller heard, without apologising",
    async () => {
      const store = createMemoryStore(SEED);
      const control = createControl({ store, makeCode: () => CODE });
      const driver = createAgentDriver({
        calls: control,
        press: control.press,
        guardSentence: createSpeechGuard({ store }),
        checkCallerLine: createSafetyCheck({ store }),
        model: createAgentSdkModel(),
        pharmacyName: SEED.pharmacyName,
      });

      const started = await control.startOutboundCall(IDS.sam, IDS.samConcerta);
      if (!started.ok) throw new Error("rule 7 refused the call");
      const { callId, lookupId } = started;
      driver.joinCall(callId, {
        direction: "outbound",
        patientId: IDS.sam,
        rxId: IDS.samConcerta,
        patientName: "Sam Rivera",
      });
      await control.press(callId, "send_code", { lookup_id: lookupId });
      await control.press(callId, "check_code", { lookup_id: lookupId, code: CODE, dob: SAM_DOB });
      await control.press(callId, "request_refill", { rx_id: IDS.samConcerta });

      // Force the situation rather than waiting for the model to word something
      // S4 catches: speakLine goes through the same guard and the same note.
      const replaced = await collect(driver.speakLine(callId, FALSE_PROMISE));
      const blocked = replaced.filter((e) => e.type === "blocked_line");

      // Then give the model a turn, which is where pass 14's apology appeared.
      const after = await collect(driver.callerSays(callId, CARRY_ON));
      const spoken = after.flatMap((e) => (e.type === "line" ? [e.text] : []));

      mkdirSync("results/agent-live", { recursive: true });
      writeFileSync(
        `results/agent-live/replaced-line-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
        `${JSON.stringify(
          {
            task: "1.2 live: no apology for a replaced line (demo pass 14)",
            via: "Claude Agent SDK on this machine's Claude Code login, no ANTHROPIC_API_KEY",
            at: new Date().toISOString(),
            spokenInsteadOf: FALSE_PROMISE,
            blocked: blocked.map((e) => (e.type === "blocked_line" ? { rule: e.rule, replacement: e.replacement } : null)),
            callerSaid: CARRY_ON,
            nextTurn: spoken,
          },
          null,
          2,
        )}\n`,
      );

      expect(blocked).toHaveLength(1);
      for (const line of spoken) expect(line, line).not.toMatch(APOLOGY);

      await driver.endCall(callId);
    },
    240_000,
  );
});
