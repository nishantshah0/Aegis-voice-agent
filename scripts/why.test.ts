import { describe, expect, it } from "vitest";
import { cardTargets, compactWhy, exportWhy, locate, scrub, WHY_TARGETS } from "./why";

const CARDS = `export const STARTING_CARDS = [
  {
    id: "2a",
    wording: "x",
  },
  {
    id: "4b",
    wording: "y",
  },
];`;

const checkpointWhy = {
  file: "lib/contract/cards.ts",
  line: {
    line_number: 7,
    status: "checkpoint",
    commit_sha: "abcdef1234567890",
    short_commit_sha: "abcdef12",
    author: "dev",
    author_time: "2026-11-21T09:00:00Z",
    checkpoint_id: "01CHECK",
    session_id: "sess-1",
    agent: "Claude Code",
    model: "claude-opus-5-5",
    prompt: "Add card 4b. Mail me at someone@example.com or 555-0199.",
    content: '    id: "4b",',
  },
};

describe("locate", () => {
  it("finds the first line holding the needle, counted from 1", () => {
    expect(locate(CARDS, 'id: "4b",')).toBe(7);
    expect(locate(CARDS, "nope")).toBeNull();
  });
});

describe("cardTargets", () => {
  it("makes one target per rule card in the cards file", () => {
    expect(cardTargets(CARDS).map((t) => [t.id, t.file, t.needle])).toEqual([
      ["card-2a", "lib/contract/cards.ts", 'id: "2a",'],
      ["card-4b", "lib/contract/cards.ts", 'id: "4b",'],
    ]);
  });
});

describe("scrub", () => {
  it("removes emails and phone-like numbers, and caps the length", () => {
    expect(scrub("mail a@b.co or call 555-0199 or (519) 555 1234")).toBe("mail [email] or call [number] or [number]");
    expect(scrub("x".repeat(900)).length).toBeLessThanOrEqual(601);
  });
});

describe("compactWhy", () => {
  it("keeps the commit, checkpoint, session and a scrubbed prompt", () => {
    expect(compactWhy({ id: "card-4b", title: "Rule 4b", file: "lib/contract/cards.ts", needle: "" }, checkpointWhy)).toEqual({
      id: "card-4b",
      title: "Rule 4b",
      file: "lib/contract/cards.ts",
      line: 7,
      content: 'id: "4b",',
      status: "checkpoint",
      commit: "abcdef12",
      author: "dev",
      authorTime: "2026-11-21T09:00:00Z",
      checkpointId: "01CHECK",
      sessionId: "sess-1",
      agent: "Claude Code",
      model: "claude-opus-5-5",
      prompt: "Add card 4b. Mail me at [email] or [number].",
    });
  });

  it("marks a line with only a commit as such, with no invented session", () => {
    const commitOnly = { file: "f.ts", line: { line_number: 3, status: "commit", short_commit_sha: "1234abcd", author: "PS", author_time: "t", content: "x" } };
    expect(compactWhy({ id: "a", title: "A", file: "f.ts", needle: "" }, commitOnly)).toMatchObject({
      status: "commit",
      commit: "1234abcd",
      checkpointId: null,
      sessionId: null,
      prompt: null,
    });
  });
});

describe("exportWhy", () => {
  it("asks entire why for each located target and reports the ones it couldn't find", async () => {
    const asked: string[] = [];
    const result = await exportWhy(
      [
        { id: "card-4b", title: "Rule 4b", file: "lib/contract/cards.ts", needle: 'id: "4b",' },
        { id: "gone", title: "Gone", file: "lib/contract/cards.ts", needle: "not there" },
      ],
      {
        read: () => CARDS,
        why: async (file, line) => {
          asked.push(`${file}:${line}`);
          return checkpointWhy;
        },
      },
    );
    expect(asked).toEqual(["lib/contract/cards.ts:7"]);
    expect(result.records.map((r) => r.id)).toEqual(["card-4b"]);
    expect(result.missing).toEqual(["gone"]);
  });

  it("covers the demo's key decisions: core rules, speech rules, the hijack and its call ids", () => {
    const ids = WHY_TARGETS.map((t) => t.id);
    for (const id of ["rule-1", "rule-5", "S1", "S2", "S3", "S4", "hijack-driver", "hijack-call-ids"]) expect(ids).toContain(id);
  });
});
