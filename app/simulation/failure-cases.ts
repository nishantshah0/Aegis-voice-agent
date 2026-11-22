import greeting from "./fixtures/greeting-slang-report.json";
import attempt from "@/results/arena/scenarios/25302a18-0aaa-469c-8245-8f6849e7d136/attempts/sam_ordinary_refill/1.json";
import scenario from "@/scenarios/sam-ordinary-refill.json";

export type EvidenceLine = { line: number; speaker: string; text: string };
export type FailureCase = {
  id: string;
  label: string;
  source: string;
  title: string;
  expected: string;
  observed: string;
  location: string;
  evidence: EvidenceLine[];
  transcriptLabel: string;
  transcript: EvidenceLine[];
  result: string;
  audioNote: string;
};

// This hand-picked synthetic attempt is already part of the public demo's saved fixed-suite run.
// Only the listed dialogue is included in the public page, with original record sequence numbers.
const excerpt = attempt.record
  .filter(entry => [2, 17, 18, 19, 20].includes(entry.seq) && (entry.kind === "line_spoken" || entry.kind === "caller_line"))
  .map(entry => ({ line: entry.seq, speaker: entry.kind === "caller_line" ? "caller" : "pharmacy", text: entry.input.text! }));

export const failureCases: FailureCase[] = [
  {
    id: greeting.id,
    label: "Greetings and slang",
    source: greeting.source,
    title: "A greeting prompted a handoff offer",
    expected: "Acknowledge “hey” and ask what the caller needs. When a phrase is unclear, ask the caller to rephrase it.",
    observed: "The assistant offered a handoff five times, on lines 3, 7, 9, 11 and 13. It also repeated the same silence prompt on consecutive lines 4 and 5.",
    location: "First missed response · lines 2–3",
    evidence: greeting.lines.slice(1, 3),
    transcriptLabel: "Read all 13 transcript lines",
    transcript: greeting.lines,
    result: "The caller’s request was still unclear when the supplied transcript ended.",
    audioNote: "No original audio or timestamps were supplied.",
  },
  {
    id: scenario.id,
    label: "Ordinary refill",
    source: "saved fixed-suite attempt · Haiku · call 1",
    title: "Sam’s refill request stopped after verification",
    expected: scenario.goal + ".",
    observed: "Sam named the prescription at entry 2 and asked for pharmacist approval at entry 18. The assistant asked Sam to choose a medicine again. The saved record ended at entry 20 without a refill request.",
    location: "Missed request · record entries 18–20",
    evidence: excerpt.filter(entry => entry.line >= 18),
    transcriptLabel: "Read the five relevant record entries",
    transcript: excerpt,
    result: `${attempt.score.checks.filter(check => !check.passed).length} automated checks failed. The scorer recorded ${attempt.score.broken} rule violations.`,
    audioNote: "This saved attempt contains a transcript. No original audio is attached.",
  },
];
