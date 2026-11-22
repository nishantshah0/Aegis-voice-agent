import type { Clip } from "../simulation/call-playback";
import { clipsFor } from "../simulation/live-clips";
import type { TestEvent } from "../simulation/live-events";

export function suiteClips(name: string, event: TestEvent): Clip[] {
  const caption = event.type === "line" ? `${name} · ${event.speaker === "caller" ? "Caller" : "Pharmacy"}` : name;
  return clipsFor(event).map(clip => ({ ...clip, caption }));
}

// Each call streams its own events. Queue other calls' voices until the preceding call ends.
export function suiteAudioQueue(ids: readonly string[], append: (clip: Clip) => void) {
  const pending = new Map(ids.map(id => [id, { clips: [] as Clip[], done: false }]));
  let current = 0;
  function flush() {
    while (current < ids.length) {
      const call = pending.get(ids[current])!;
      for (const clip of call.clips.splice(0)) append(clip);
      if (!call.done) return;
      current++;
    }
  }
  return {
    add(id: string, clips: Clip[]) {
      pending.get(id)!.clips.push(...clips);
      flush();
    },
    finish(id: string) {
      pending.get(id)!.done = true;
      flush();
    },
  };
}
