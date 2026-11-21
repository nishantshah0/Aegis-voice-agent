"use client";

import { useEffect, useRef, useState } from "react";
import { createListener, type Listener, type ListenerMode } from "@/lib/voice/listener";
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
};

// Voice on the phone (task 1.5): the agent's lines are spoken as they arrive, the
// microphone is off while it speaks, and the caller's turn ends after 600 ms of silence.
export function useVoice({ on, mode, callId, transcript, onTurn, onProblem, onSpeechStart }: VoiceOptions) {
  const [hearing, setHearing] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const listener = useRef<Listener | undefined>(undefined);
  const voice = useRef<Voice | undefined>(undefined);
  const spokenUpTo = useRef(0);
  const turnRef = useRef(onTurn);
  const problemRef = useRef(onProblem);
  const speechStartRef = useRef(onSpeechStart);
  useEffect(() => {
    turnRef.current = onTurn;
    problemRef.current = onProblem;
    speechStartRef.current = onSpeechStart;
  });

  // One listener and one voice per call, while voice is on.
  useEffect(() => {
    if (!on || !callId) return;
    const l = createListener({ onTurn: (t) => turnRef.current(t), onHearing: setHearing, onProblem: (t) => problemRef.current(t) });
    const v = createBrowserVoice({
      onSpeaking: (s) => {
        setSpeaking(s);
        if (s) speechStartRef.current?.();
        if (s) l.pause();
        else l.resume();
      },
    });
    listener.current = l;
    voice.current = v;
    l.start(mode);
    return () => {
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
    holdDown: () => listener.current?.holdDown(),
    holdUp: () => listener.current?.holdUp(),
  };
}
