import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Approver } from "@/lib/contract";

// Hand labels for finished calls, kept in an append-only file:
// results/labels/labels.jsonl, one label per line. The labeller always comes from the
// Auth0 session (see ./labels/route.ts), never from the request.

export const resultsDir = () => process.env.RESULTS_DIR ?? join(process.cwd(), "results");

/** The yes/no questions a person and the AI judge can both answer. */
export const YES_NO = ["outcomeRight", "wrongPromise", "unsafeOrAdvice"] as const;
export type YesNo = (typeof YES_NO)[number];

export const TONES = ["good", "ok", "poor"] as const;

export const marksSchema = z.object({
  outcomeRight: z.boolean().nullable(),
  wrongPromise: z.boolean().nullable(),
  unsafeOrAdvice: z.boolean().nullable(),
  tone: z.enum(TONES).nullable(),
  saveAsTest: z.boolean(),
});
export type Marks = z.infer<typeof marksSchema>;

export const labelBodySchema = z.object({
  callId: z.string().min(1).max(80),
  marks: marksSchema,
  note: z.string().max(500).optional(),
});

export type Label = { callId: string; marks: Marks; by: Approver; note?: string; at: string };

const fileIn = (dir: string) => join(dir, "labels", "labels.jsonl");

export async function saveLabel(input: { callId: string; marks: Marks; by: Approver; note?: string }, dir: string = resultsDir()): Promise<Label> {
  const label: Label = {
    callId: input.callId,
    marks: input.marks,
    by: { id: input.by.id, name: input.by.name, role: input.by.role },
    ...(input.note ? { note: input.note } : {}),
    at: new Date().toISOString(),
  };
  await mkdir(join(dir, "labels"), { recursive: true });
  await appendFile(fileIn(dir), `${JSON.stringify(label)}\n`);
  return label;
}

/** Every saved label, oldest first. Lines that don't parse are skipped. */
export async function readLabels(dir: string = resultsDir()): Promise<Label[]> {
  const text = await readFile(fileIn(dir), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Label];
      } catch {
        return [];
      }
    });
}

/** Each labeller's newest label, per call. */
export function latestLabels(labels: Label[]): Map<string, Label[]> {
  const latest = new Map<string, Map<string, Label>>();
  for (const label of labels) {
    const perCall = latest.get(label.callId) ?? new Map<string, Label>();
    perCall.set(label.by.id, label);
    latest.set(label.callId, perCall);
  }
  return new Map([...latest.entries()].map(([callId, perCall]) => [callId, [...perCall.values()]]));
}

export type Agreement = {
  compared: number;
  agreed: number;
  disagreements: { callId: string; mark: YesNo; judge: boolean; people: boolean }[];
  files: string[];
};

/**
 * How often saved AI judge results (results/arena/judge/*.json: one object or an array of
 * { callId, outcomeRight?, wrongPromise?, unsafeOrAdvice? }) agree with people's newest
 * labels. Null when no judge result is saved: then the page shows no rate at all.
 */
export async function judgeAgreement(labels: Label[], dir: string = resultsDir()): Promise<Agreement | null> {
  const judgeDir = join(dir, "arena", "judge");
  const files = (await readdir(judgeDir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).map((f) => join(judgeDir, f));
  const verdicts: Record<string, unknown>[] = [];
  for (const file of files) {
    try {
      const json: unknown = JSON.parse(await readFile(file, "utf8"));
      for (const v of Array.isArray(json) ? json : [json]) if (v && typeof v === "object") verdicts.push(v as Record<string, unknown>);
    } catch {
      // An unreadable judge file adds nothing.
    }
  }
  if (!verdicts.length) return null;

  const people = latestLabels(labels);
  const result: Agreement = { compared: 0, agreed: 0, disagreements: [], files };
  for (const verdict of verdicts) {
    const callId = typeof verdict.callId === "string" ? verdict.callId : "";
    for (const label of people.get(callId) ?? []) {
      for (const mark of YES_NO) {
        const judge = verdict[mark];
        const person = label.marks[mark];
        if (typeof judge !== "boolean" || typeof person !== "boolean") continue;
        result.compared += 1;
        if (judge === person) result.agreed += 1;
        else result.disagreements.push({ callId, mark, judge, people: person });
      }
    }
  }
  return result;
}
