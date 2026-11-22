import { afterEach, describe, expect, it, vi } from "vitest";
import { replayLines, speakReplayLine } from "./replay";

describe("saved call audio", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("plays the actual dialogue once, including only the safe replacement of a blocked line", () => {
    expect(replayLines([
      { seq: 1, kind: "caller_line", text: "I want a person." },
      { seq: 2, kind: "safety", text: "I want a person.", replacement: "I'll transfer you." },
      { seq: 3, kind: "line_spoken", text: "I'll transfer you." },
      { seq: 4, kind: "button", text: "check_code" },
      { seq: 5, kind: "line_blocked", text: "Don't say this", replacement: "Please wait." },
    ])).toEqual([
      { seq: 1, speaker: "caller", text: "I want a person." },
      { seq: 3, speaker: "pharmacy", text: "I'll transfer you." },
      { seq: 5, speaker: "pharmacy", text: "Please wait." },
    ]);
  });
  it("cancels the active utterance even when the browser never fires its end event", async () => {
    const speech = { getVoices: () => [], speak: vi.fn(), cancel: vi.fn() };
    vi.stubGlobal("window", { speechSynthesis: speech });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    const stop = new AbortController();
    const played = speakReplayLine({ seq: 1, speaker: "caller", text: "Hello" }, stop.signal);
    expect(speech.speak).toHaveBeenCalledOnce();
    stop.abort();
    await expect(played).resolves.toBeUndefined();
    expect(speech.cancel).toHaveBeenCalledOnce();
  });
});
