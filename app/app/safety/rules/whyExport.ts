import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Read-only: Role 4's `entire why` export (results/why/, task 4.10). The prompt text is
// left out on purpose: it is team chatter, not product data.

export type WhyRecord = {
  id: string;
  title: string;
  file: string;
  line: number;
  content?: string;
  status: string;
  commit: string | null;
  author?: string | null;
  authorTime?: string | null;
  checkpointId: string | null;
  sessionId: string | null;
  agent?: string | null;
  model?: string | null;
};

export type WhyExport = { generatedAt: string; records: WhyRecord[]; missing: string[] } | null;

const dir = () => join(process.env.RESULTS_DIR ?? join(process.cwd(), "results"), "why");

export async function readWhy(): Promise<WhyExport> {
  try {
    const index = JSON.parse(await readFile(join(dir(), "index.json"), "utf8")) as { generatedAt: string; records: { id: string }[]; missing?: string[] };
    const records = await Promise.all(
      index.records.map(async (r) => {
        const full = await readFile(join(dir(), `${r.id}.json`), "utf8").then((t) => JSON.parse(t) as WhyRecord).catch(() => r as WhyRecord);
        const { id, title, file, line, content, status, commit, author, authorTime, checkpointId, sessionId, agent, model } = full;
        return { id, title, file, line, content, status, commit, author, authorTime, checkpointId, sessionId, agent, model };
      }),
    );
    return { generatedAt: index.generatedAt, records, missing: index.missing ?? [] };
  } catch {
    return null;
  }
}
