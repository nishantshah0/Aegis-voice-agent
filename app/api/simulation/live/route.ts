import { fail, readObject } from "../../_lib/http";
import { simulationAccessRefused } from "../access";
import { DemoRunError, isDemoScenario, runLiveDemo, type DemoEvent } from "./run";

const windowMs = 60 * 60_000;
const state = globalThis as typeof globalThis & { __simulationLiveRuns?: { active: number; starts: number[] } };

export async function POST(request: Request) {
  const refused = simulationAccessRefused(request);
  if (refused) return refused;
  const body = await readObject(request);
  if (!body || Object.keys(body).length !== 1 || !isDemoScenario(body.scenarioId)) return fail(400, "Choose a listed live test.");
  const id = body.scenarioId;
  if (!process.env.ANTHROPIC_API_KEY) return fail(503, "The live model is not configured.");
  const budget = state.__simulationLiveRuns ??= { active: 0, starts: [] };
  const now = Date.now();
  budget.starts = budget.starts.filter(at => at > now - windowMs);
  if (budget.active >= 2) return fail(429, "Two live tests are running. Try again when one finishes.");
  if (budget.starts.length >= 6) return fail(429, "Six live tests have started in the past hour. Try again later.");
  budget.starts.push(now);
  budget.active += 1;
  const stop = new AbortController();
  const deadline = AbortSignal.timeout(120_000);
  const signal = AbortSignal.any([stop.signal, request.signal, deadline]);
  const encode = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: DemoEvent) => controller.enqueue(encode.encode(JSON.stringify(event) + "\n"));
      void runLiveDemo(id, signal, send).catch((error: unknown) => {
        if (!request.signal.aborted && !stop.signal.aborted) {
          send({ type: "error", message: deadline.aborted ? "The live test timed out." : error instanceof DemoRunError ? error.message : "The live test could not finish. No verdict was scored." });
        }
      }).finally(() => {
        budget.active -= 1;
        if (!stop.signal.aborted) controller.close();
      });
    },
    cancel() { stop.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
