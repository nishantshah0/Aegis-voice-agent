import { forSpeech } from "./spoken";

export type ReplayEntry = { seq: number; kind: string; text?: string; replacement?: string };
export type ReplayLine = { seq: number; speaker: "caller" | "pharmacy"; text: string };

/** Safety checks describe a caller line and a proposed script; their actual speech has separate entries. */
export function replayLines(entries: ReplayEntry[]): ReplayLine[] {
  const lines: ReplayLine[] = [];
  for (const entry of entries) {
    let text: string | undefined;
    if (entry.kind === "line_blocked") text = entry.replacement;
    else if (entry.kind === "caller_line" || entry.kind === "line_spoken") text = entry.text;
    if (text?.trim()) lines.push({ seq: entry.seq, speaker: entry.kind === "caller_line" ? "caller" : "pharmacy", text });
  }
  return lines;
}

export function speakReplayLine(line: ReplayLine, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const speech = window.speechSynthesis;
  if (!speech || typeof SpeechSynthesisUtterance === "undefined") return Promise.reject(new Error("Speech playback is unavailable in this browser."));
  const utterance = new SpeechSynthesisUtterance(forSpeech(line.text));
  const voices = speech.getVoices().filter((voice) => voice.lang.startsWith("en")).sort((a, b) => Number(b.localService) - Number(a.localService));
  utterance.lang = "en-US";
  const voice = voices[line.speaker === "caller" && voices.length > 1 ? 1 : 0];
  if (voice) utterance.voice = voice;
  utterance.pitch = line.speaker === "caller" ? 0.88 : 1.05;
  utterance.rate = 0.95;
  return new Promise((resolve, reject) => {
    // Some browser engines expose speechSynthesis without a working system voice.
    const startup = setTimeout(() => {
      finish();
      speech.cancel();
      reject(new Error("The browser did not start a voice. Check the device’s speech settings."));
    }, 12_000);
    const finish = () => {
      clearTimeout(startup);
      signal.removeEventListener("abort", stop);
      utterance.onstart = utterance.onend = utterance.onerror = null;
    };
    const stop = () => {
      finish();
      speech.cancel();
      resolve();
    };
    utterance.onstart = () => clearTimeout(startup);
    utterance.onend = () => { finish(); resolve(); };
    utterance.onerror = () => { finish(); reject(new Error("The browser could not play this voice.")); };
    signal.addEventListener("abort", stop, { once: true });
    try { speech.speak(utterance); }
    catch (error) { finish(); reject(error); }
  });
}

/** Reuse rendered clips only for this call. Every media element and object URL ends with its turn. */
export async function playClip(blob: Blob, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  try {
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        audio.onended = audio.onerror = null;
        signal.removeEventListener("abort", stop);
      };
      const stop = () => { done(); audio.pause(); resolve(); };
      audio.onended = () => { done(); resolve(); };
      audio.onerror = () => { done(); reject(new Error("Could not play the generated audio.")); };
      signal.addEventListener("abort", stop, { once: true });
      void audio.play().catch((error) => { done(); reject(error); });
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
