import { connection } from "next/server";
import { fail } from "../../../_lib/http";
import { simulationAccessRefused } from "../../access";
import { demoArchive } from "../archive";
import { isDemoScenario, signedDemoLine, type DemoEvent } from "../public-record";

export async function GET(request: Request) {
  await connection();
  const refused = simulationAccessRefused(request);
  if (refused) return refused;
  const params = new URL(request.url).searchParams;
  const id = params.get("scenarioId");
  if (params.size !== 1 || !isDemoScenario(id)) return fail(400, "Choose a listed live test.");
  let saved;
  try { saved = await demoArchive().latest(id); }
  catch { return fail(500, "The saved test could not be read."); }
  if (!saved) return fail(404, "No completed run is saved for this test.");
  const events = saved.events;
  let index = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const entry = events[index++];
      let event: DemoEvent;
      if (entry.type === "start") event = { type: "start", scenarioId: id };
      else if (entry.type === "line") {
        event = signedDemoLine(id, entry, index);
      } else {
        event = entry;
      }
      controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      if (index === events.length) controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store", "X-Accel-Buffering": "no" } });
}
