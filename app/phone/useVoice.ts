"use client";

import { useEffect, useRef, useState } from "react";
import { createListener, type Listener, type ListenerMode } from "@/lib/voice/listener";
import { createSilenceWatch } from "@/lib/voice/silence";
import { createBrowserVoice, type Voice } from "@/lib/voice/speaker";
import type { TranscriptItem } from "./state";

/** Agent lines after index `from`: what the voice still has to say. */
export function newAgentLines(items: TranscriptItem[], from: number): string[] {
  return items.slice(from).flatMap((t) => (t.kind === "line" && t.who === "agent" ? [t.text] : []));
}

type VoiceOptions = {
  on: boolean;
  mode: ListenerMode;
  callId?: string;
  transcript: TranscriptItem[];
  onTurn: (text: string) => void;
  onProblem: (text: string) => void;
  /** The voice started speaking (for turn timing). */
  onSpeechStart?: () => void;
  /** The caller has said nothing for a while after the agent finished (task 1.8). */
  onSilence?: () => void;
};

// Voice on the phone (task 1.5): the agent's lines are spoken as they arrive, the
// microphone is off while it speaks, and the caller's turn ends after 600 ms of silence.
export function useVoice({ on, mode, callId, transcript, onTurn, onProblem, onSpeechStart, onSilence }: VoiceOptions) {
  const [hearing, setHearing] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const listener = useRef<Listener | undefined>(undefined);
  const voice = useRef<Voice | undefined>(undefined);
  const spokenUpTo = useRef(0);
  const turnRef = useRef(onTurn);
  const problemRef = useRef(onProblem);
  const speechStartRef = useRef(onSpeechStart);
  const silenceRef = useRef(onSilence);
  useEffect(() => {
    turnRef.current = onTurn;
    problemRef.current = onProblem;
    speechStartRef.current = onSpeechStart;
    silenceRef.current = onSilence;
  });

  // One listener and one voice per call, while voice is on.
  useEffect(() => {
    if (!on || !callId) return;
    // Silence only counts in open mode: in hold-to-talk, quiet is the normal state.
    const silence = createSilenceWatch(() => silenceRef.current?.());
    const watching = mode === "open";
    const l = createListener({
      onTurn: (t) => {
        silence.cancel();
        turnRef.current(t);
      },
      onHearing: (t) => {
        setHearing(t);
        if (t) silence.cancel();
      },
      onProblem: (t) => problemRef.current(t),
    });
    const v = createBrowserVoice({
      onSpeaking: (s) => {
        setSpeaking(s);
        if (s) {
          speechStartRef.current?.();
          silence.cancel();
          l.pause();
        } else {
          l.resume();
          if (watching) silence.arm();
        }
      },
    });
    listener.current = l;
    voice.current = v;
    l.start(mode);
    return () => {
      silence.cancel();
      l.stop();
      v.stop();
      listener.current = voice.current = undefined;
    };
  }, [on, mode, callId]);

  // Speak only lines that arrive after voice was turned on.
  useEffect(() => {
    if (!on) spokenUpTo.current = transcript.length;
  }, [on, transcript.length]);
  useEffect(() => {
    if (!on || !voice.current) return;
    for (const line of newAgentLines(transcript, spokenUpTo.current)) void voice.current.say(line);
    spokenUpTo.current = transcript.length;
  }, [on, transcript]);

  return {
    hearing,
    speaking,
    /** Tap to interrupt (task 1.8): stop the voice now; the microphone reopens. */
    interrupt: () => voice.current?.stop(),
    holdDown: () => listener.current?.holdDown(),
    holdUp: () => listener.current?.holdUp(),
  };
}
