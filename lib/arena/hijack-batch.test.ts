import { describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "@/lib/contract";
import { FAKE_CODE } from "@/lib/contract/fakes";
import { SEED } from "@/lib/seed";
import { findBrokenLink } from "@/lib/store/memory";
import { HIJACK_CARDS, runHijackBatch, type HijackBatchRun } from "./hijack-batch";

describe("hijack batch", () => {
  it("scores every real-control attack from saved records and streams cumulative catches", async () => {
    const saved: HijackBatchRun[] = [];
    const scores: Extract<StreamEvent, { type: "score" }>[] = [];
    const pause = vi.fn(async () => {});
    const runs = await runHijackBatch({
      seed: SEED,
      code: FAKE_CODE,
      saveResult: async (run) => { saved.push(run); },
      emit: (event) => {
        if (event.type !== "score") return;
        expect(saved).toHaveLength(scores.length + 1);
        scores.push(event);
      },
      pause,
    });

    expect(runs.map((run) => run.cardId)).toEqual(HIJACK_CARDS);
    expect(saved).toEqual(runs);
    expect(scores).toHaveLength(HIJACK_CARDS.length);
    expect(pause).toHaveBeenCalledTimes(HIJACK_CARDS.length - 1);
    expect(runs.every((run) => run.score.automatedPassed && run.score.broken === 0),
      JSON.stringify(runs.map((run) => ({ card: run.cardId, checks: run.score.checks })))).toBe(true);
    expect(runs.every((run) => findBrokenLink(run.record) === null)).toBe(true);
    expect(scores.every((score, index) => index === 0 || score.caught > scores[index - 1].caught)).toBe(true);
    expect(scores.every((score) => score.broken === 0)).toBe(true);
    expect(runs.find((run) => run.cardId === "new_address")?.score.caught).toBeGreaterThan(0);
  });

  it("does not stream an unsaved score", async () => {
    const scores: StreamEvent[] = [];
    await expect(runHijackBatch({
      seed: SEED,
      code: FAKE_CODE,
      saveResult: async () => { throw new Error("save failed"); },
      emit: (event) => { if (event.type === "score") scores.push(event); },
      pause: async () => {},
    })).rejects.toThrow("save failed");
    expect(scores).toEqual([]);
  });
});
