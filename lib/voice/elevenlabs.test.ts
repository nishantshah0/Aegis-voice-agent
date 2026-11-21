// No key and no network: every test injects a fake `fetchClip` and a fake `play`,
// so nothing here reaches ElevenLabs. The one test that exercises the real
// `createClipFetcher` hands it a stub `fetch`.

import { describe, expect, it, vi } from "vitest";

import { outboundOpener } from "@/lib/agent/lines";

import {
  type Clip,
  type FetchClip,
  type PlayClip,
  type Playing,
  createClipFetcher,
  createElevenLabsVoice,
  fixedLineTexts,
} from "./elevenlabs";
import type { Voice } from "./speaker";

const PHARMACY = "Maple Street Pharmacy";

const clipFor = (text: string): Clip => new TextEncoder().encode(text).buffer as ArrayBuffer;
const textOf = (clip: Clip): string => new TextDecoder().decode(clip);

/** Records what was asked for and hands back a clip naming it. */
function recordingFetcher() {
  const asked: string[] = [];
  const fetchClip: FetchClip = async (spoken) => {
    asked.push(spoken);
    return clipFor(spoken);
  };
  return { asked, fetchClip };
}

/** Plays instantly and records the order. */
function recordingPlayer() {
  const played: string[] = [];
  const play: PlayClip = (clip) => {
    played.push(textOf(clip));
    return { ended: Promise.resolve(), stop: () => {} };
  };
  return { played, play };
}

/** A player whose clip never finishes until released, so `stop` can be tested. */
function heldPlayer() {
  let release = () => {};
  let stopped = 0;
  const play: PlayClip = () => {
    const ended = new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      ended,
      stop: () => {
        stopped += 1;
        release();
      },
    };
  };
  return { play, stops: () => stopped };
}

describe("the ElevenLabs voice speaks guarded lines in order", () => {
  it("plays one line at a time, in the order they were queued", async () => {
    const { fetchClip } = recordingFetcher();
    const { played, play } = recordingPlayer();
    const voice = createElevenLabsVoice({ fetchClip, play });

    await Promise.all([voice.say("One moment."), voice.say("All set."), voice.say("Goodbye.")]);

    expect(played).toEqual(["One moment.", "All set.", "Goodbye."]);
  });

  it("rewrites the line for the ear before asking for audio", async () => {
    const { asked, fetchClip } = recordingFetcher();
    const { play } = recordingPlayer();
    const voice = createElevenLabsVoice({ fetchClip, play });

    await voice.say("Your code is 112358 and it costs $4.10.");

    // forSpeech runs first, so the server synthesises what a person would say.
    expect(asked).toEqual(["Your code is 1 1 2, 3 5 8 and it costs four dollars and ten cents."]);
  });

  it("brackets the whole queue with onSpeaking, so the mic stays off throughout", async () => {
    const { fetchClip } = recordingFetcher();
    const { play } = recordingPlayer();
    const states: boolean[] = [];
    const voice = createElevenLabsVoice({ fetchClip, play, onSpeaking: (s) => states.push(s) });

    await Promise.all([voice.say("First."), voice.say("Second.")]);

    // One true before anything is heard, one false once the queue is empty:
    // the phone mutes the microphone on true and reopens it on false.
    expect(states).toEqual([true, false]);
  });
});

describe("fixed lines are fetched once", () => {
  it("reuses the clip for a preloaded fixed line and refetches anything else", async () => {
    const { asked, fetchClip } = recordingFetcher();
    const { play } = recordingPlayer();
    const voice = createElevenLabsVoice({ fetchClip, play, preload: fixedLineTexts(PHARMACY) });

    await voice.say("One moment.");
    await voice.say("One moment.");
    await voice.say("Your refill is on its way.");
    await voice.say("Your refill is on its way.");

    expect(asked.filter((a) => a === "One moment.")).toHaveLength(1);
    expect(asked.filter((a) => a === "Your refill is on its way.")).toHaveLength(2);
  });

  it("never keeps the outbound opener, because it carries a patient's name", () => {
    const fixed = fixedLineTexts(PHARMACY);
    const opener = outboundOpener(PHARMACY, "Sam Rivera");

    expect(fixed).not.toContain(opener);
    for (const line of fixed) expect(line).not.toMatch(/Sam|Rivera/);
  });

  it("holds the lines that are the same on every call", () => {
    const fixed = fixedLineTexts(PHARMACY);
    expect(fixed).toContain("One moment.");
    expect(fixed).toContain("If those details match, I've sent a code to the phone on file.");
    expect(fixed.some((l) => l.includes(PHARMACY))).toBe(true);
  });
});

describe("a clip that does not arrive falls back to Chrome's voice", () => {
  it("says the line on the fallback and reports the problem", async () => {
    const said: string[] = [];
    const fallback: Voice = {
      say: async (line) => void said.push(line),
      stop: () => {},
    };
    const problems: string[] = [];
    const fetchClip: FetchClip = async () => {
      throw new Error("voice clip 503");
    };
    const { played, play } = recordingPlayer();
    const voice = createElevenLabsVoice({
      fetchClip,
      play,
      fallback,
      onProblem: (line) => problems.push(line),
    });

    await voice.say("A pharmacist may call you to check in.");

    expect(said).toEqual(["A pharmacist may call you to check in."]);
    expect(problems).toEqual(["A pharmacist may call you to check in."]);
    expect(played).toEqual([]);
  });

  it("carries on with the rest of the queue after one line fails", async () => {
    let calls = 0;
    const fetchClip: FetchClip = async (spoken) => {
      calls += 1;
      if (calls === 1) throw new Error("voice clip 500");
      return clipFor(spoken);
    };
    const said: string[] = [];
    const fallback: Voice = { say: async (line) => void said.push(line), stop: () => {} };
    const { played, play } = recordingPlayer();
    const voice = createElevenLabsVoice({ fetchClip, play, fallback });

    await Promise.all([voice.say("First."), voice.say("Second.")]);

    expect(said).toEqual(["First."]);
    expect(played).toEqual(["Second."]);
  });

  it("drops the line rather than throwing when the fallback fails too", async () => {
    const fetchClip: FetchClip = async () => {
      throw new Error("voice clip 503");
    };
    const fallback: Voice = {
      say: async () => {
        throw new Error("no speech synthesis either");
      },
      stop: () => {},
    };
    const { play } = recordingPlayer();
    const voice = createElevenLabsVoice({ fetchClip, play, fallback });

    await expect(voice.say("One moment.")).resolves.toBeUndefined();
  });
});

describe("stop drops everything", () => {
  it("stops the clip playing, clears the queue and settles every pending line", async () => {
    const { fetchClip } = recordingFetcher();
    const held = heldPlayer();
    const states: boolean[] = [];
    const voice = createElevenLabsVoice({
      fetchClip,
      play: held.play,
      onSpeaking: (s) => states.push(s),
    });

    const first = voice.say("One moment.");
    const second = voice.say("All set.");
    await vi.waitFor(() => expect(held.stops()).toBe(0));

    voice.stop();

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(held.stops()).toBe(1);
    expect(states).toEqual([true, false]);
  });

  it("aborts a fetch in flight", async () => {
    let seen: AbortSignal | undefined;
    const fetchClip: FetchClip = (_spoken, signal) => {
      seen = signal;
      return new Promise<Clip>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };
    const { play } = recordingPlayer();
    const voice = createElevenLabsVoice({ fetchClip, play });

    const line = voice.say("One moment.");
    await vi.waitFor(() => expect(seen).toBeDefined());
    voice.stop();

    expect(seen!.aborted).toBe(true);
    await expect(line).resolves.toBeUndefined();
  });

  it("speaks again after a stop", async () => {
    const { fetchClip } = recordingFetcher();
    const { played, play } = recordingPlayer();
    const voice = createElevenLabsVoice({ fetchClip, play });

    voice.stop();
    await voice.say("Still here.");

    expect(played).toEqual(["Still here."]);
  });
});

describe("the clip fetcher", () => {
  it("posts the spoken text and returns the audio", async () => {
    const bytes = clipFor("audio");
    const fetchMock = vi.fn(async () => new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const clip = await createClipFetcher("/api/voice/clip")("One moment.", new AbortController().signal);

    expect(textOf(clip)).toBe("audio");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/voice/clip");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "One moment." });
    vi.unstubAllGlobals();
  });

  it("throws on a non-200, which is what sends the line to the fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));

    await expect(createClipFetcher()("One moment.", new AbortController().signal)).rejects.toThrow(/503/);
    vi.unstubAllGlobals();
  });
});

describe("it never invents a line", () => {
  it("has no hardcoded sentence of its own", async () => {
    // Everything spoken comes from the caller, which is the guard's `speak`.
    const { asked, fetchClip } = recordingFetcher();
    const { play } = recordingPlayer();
    const voice = createElevenLabsVoice({ fetchClip, play });

    await voice.say("Exactly this.");

    expect(asked).toEqual(["Exactly this."]);
  });
});
