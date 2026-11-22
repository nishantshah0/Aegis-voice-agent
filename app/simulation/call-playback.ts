export type Clip = { url?: string; ticket?: string; skip?: boolean };
export type PlaybackState = { mode: "idle" | "waiting" | "loading" | "playing" | "paused" | "done" | "error" | "blocked"; index: number; problem: string; muted?: boolean };

// A single silent PCM sample lets the initial click authorize this element before the live server's first reply.
const SILENCE = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";

export class CallPlayback {
  private clips: Clip[];
  private finished: boolean;
  private state: PlaybackState = { mode: "idle", index: 0, problem: "" };
  private listeners = new Set<() => void>();
  private audio?: HTMLAudioElement;
  private pending?: AbortController;
  private attached = -1;
  private wanted = false;
  private cache = new Map<string, string>();
  private muted = false;

  constructor(clips: Clip[] = [], finished = false) {
    this.clips = [...clips];
    this.finished = finished;
  }

  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(mode: PlaybackState["mode"], index = this.state.index, problem = "") {
    this.state = { mode, index, problem, muted: this.muted };
    this.listeners.forEach(fn => fn());
  }

  append(clip: Clip) {
    this.clips.push(clip);
    if (this.wanted && this.state.mode === "waiting") this.pump();
  }

  /** Silence the call without stopping it: the lines keep moving, so unmuting picks up live. */
  mute(on: boolean) {
    this.muted = on;
    if (this.audio) this.audio.muted = on;
    this.update(this.state.mode);
  }

  finish() {
    this.finished = true;
    if (this.wanted && this.state.mode === "waiting") this.pump();
  }

  play() {
    this.wanted = true;
    if (this.state.mode === "done") this.update("idle", 0);
    this.audio ??= new Audio();
    this.audio.muted = this.muted;
    if (!this.clips[this.state.index]?.url && this.attached === -1) {
      this.audio.src = SILENCE;
      void this.audio.play().catch(() => {}); // An actual blocked line offers the Enable sound button.
    }
    this.pump();
  }

  skip() {
    this.attached = -1;
    this.update("loading", this.state.index + 1);
    this.play();
  }

  pause() {
    this.wanted = false;
    this.audio?.pause();
    this.update("paused");
  }

  stop() {
    this.wanted = false;
    this.pending?.abort();
    this.pending = undefined;
    if (this.audio) {
      this.audio.onplaying = this.audio.onended = this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.attached = -1;
    this.update("idle", 0);
  }

  dispose() {
    this.stop();
    this.cache.forEach(url => URL.revokeObjectURL(url));
    this.cache.clear();
  }

  private fail(error: unknown) {
    this.wanted = false;
    const blocked = error instanceof Error && error.name === "NotAllowedError";
    this.update(blocked ? "blocked" : "error", this.state.index, blocked ? "Enable sound to hear the call." :
      error instanceof Error ? error.message : "Could not play this line.");
  }

  private pump() {
    if (!this.wanted || this.pending) return;
    const index = this.state.index;
    const clip = this.clips[index];
    if (!clip) {
      if (this.finished) this.wanted = false;
      this.update(this.finished ? "done" : "waiting");
      return;
    }
    if (clip.skip) {
      this.update("loading", index + 1);
      this.pump();
      return;
    }
    const audio = this.audio!;
    if (this.attached === index) {
      this.update("loading");
      void audio.play().catch(error => { if (this.wanted && this.attached === index) this.fail(error); });
      return;
    }
    const url = clip.url ?? (clip.ticket && this.cache.get(clip.ticket));
    if (url) { this.attach(audio, index, url); return; }
    if (!clip.ticket) { this.fail(new Error("This line has no ElevenLabs audio. The transcript remains available.")); return; }
    const pending = new AbortController();
    this.pending = pending;
    this.update("loading");
    void this.fetchClip(clip.ticket, pending);
  }

  private async fetchClip(ticket: string, pending: AbortController) {
    try {
      const res = await fetch("/api/simulation/speak", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }), signal: pending.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : `ElevenLabs playback failed (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      if (pending.signal.aborted) return;
      this.cache.set(ticket, URL.createObjectURL(blob));
      this.pending = undefined;
      this.pump();
    } catch (error) {
      if (!pending.signal.aborted) { this.pending = undefined; this.fail(error); }
    }
  }

  private attach(audio: HTMLAudioElement, index: number, url: string) {
    this.attached = index;
    this.update("loading", index);
    audio.onplaying = () => { if (this.wanted && this.attached === index) this.update("playing", index); };
    audio.onerror = () => {
      if (this.attached !== index) return;
      const ticket = this.clips[index].ticket;
      if (ticket && this.cache.delete(ticket)) URL.revokeObjectURL(url);
      this.attached = -1;
      this.fail(new Error("The audio could not be played. Retry this line."));
    };
    audio.onended = () => {
      if (!this.wanted || this.attached !== index) return;
      this.attached = -1;
      this.update("loading", index + 1);
      this.pump();
    };
    audio.src = url;
    void audio.play().catch(error => { if (this.wanted && this.attached === index) this.fail(error); });
  }
}
