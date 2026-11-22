import type { Clip } from "./call-playback";
import type { TestEvent } from "./live-events";

// What a test call sounds like, from its streamed events. Lines the guard let through carry a
// signed ticket and are voiced by /api/simulation/speak (caller and pharmacy in different
// ElevenLabs voices). A replaced line is announced by a short tone, then the line said in its
// place: the blocked text is never sent to a voice. Redacted identity lines are skipped.

export const REPLACED_ACTION = "Speech guard replaced a line";

/** A two-step low buzz, 0.44 s of 16-bit mono PCM at 8 kHz, built here so no file or provider is needed. */
export function blockedToneWav(): Uint8Array {
  const rate = 8000;
  const parts = [
    { hz: 196, ms: 200 },
    { hz: 0, ms: 40 },
    { hz: 147, ms: 200 },
  ];
  const samples: number[] = [];
  for (const { hz, ms } of parts) {
    const n = Math.round((rate * ms) / 1000);
    for (let i = 0; i < n; i++) {
      const fade = Math.min(1, i / 80, (n - i) / 80); // no clicks at the edges
      samples.push(hz ? Math.round((Math.sin((2 * Math.PI * hz * i) / rate) >= 0 ? 1 : -1) * 6000 * fade) : 0);
    }
  }
  const data = samples.length * 2;
  const wav = new Uint8Array(44 + data);
  const v = new DataView(wav.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, data, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return wav;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export const BLOCKED_TONE = `data:audio/wav;base64,${base64(blockedToneWav())}`;

/** One event's clips, in the order the call was heard. */
export function clipsFor(event: TestEvent): Clip[] {
  if (event.type === "action" && event.label === REPLACED_ACTION) return [{ url: BLOCKED_TONE }];
  if (event.type !== "line") return [];
  return [event.ticket ? { ticket: event.ticket } : { skip: true }];
}

export const clipsFromEvents = (events: TestEvent[]): Clip[] => events.flatMap(clipsFor);
