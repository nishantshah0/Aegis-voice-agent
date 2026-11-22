import { describe, expect, it, vi } from "vitest";
import { prepareSolanaAnchor } from "./solana-anchor";

const root = new Uint8Array(32).fill(7);
const note = new TextEncoder().encode(`tracekit.example\n4\n${Buffer.from(root).toString("base64")}\n— log 0x01 signature\n`);
const trust = new TextEncoder().encode(JSON.stringify({
  logs: ["log-key"],
  witnesses: [{ vkey: "public-witness", class: "public" }],
  witnesses_required: 1,
}));

function adapters(options: { code?: number; integrity?: string; assurance?: string } = {}) {
  const files = new Map<string, Uint8Array>([
    ["proofs/records.json", new TextEncoder().encode(JSON.stringify({ checkpoint: "checkpoints/4.note", tree_size: 4 }))],
    ["checkpoints/4.note", note],
  ]);
  const verify = vi.fn(async () => ({
    code: options.code ?? 0,
    report: { integrity: options.integrity ?? "VERIFIED", assurance: options.assurance ?? "witnessed: independent witness" },
  }));
  return { files, verify };
}

describe("prepareSolanaAnchor", () => {
  it("creates a minimal memo from a verified, independently witnessed checkpoint", async () => {
    const deps = adapters();
    const prepared = await prepareSolanaAnchor(new Uint8Array([1, 2]), trust, {
      verify: deps.verify as never,
      readZip: async () => deps.files,
    });

    expect(deps.verify).toHaveBeenCalledOnce();
    expect(prepared).toEqual({
      treeSize: 4,
      rootHex: "07".repeat(32),
      memo: `refill-guard.tracekit.v1|4|${"07".repeat(32)}`,
    });
  });

  it.each([
    { code: 1, label: "failed verification" },
    { integrity: "UNVERIFIABLE", label: "unverifiable integrity" },
    { assurance: "local: operator witness", label: "non-independent witness" },
  ])("rejects $label", async ({ label: _label, ...options }) => {
    const deps = adapters(options);
    await expect(prepareSolanaAnchor(new Uint8Array([1]), trust, {
      verify: deps.verify as never,
      readZip: async () => deps.files,
    })).rejects.toThrow();
  });

  it("rejects a trust configuration that does not require an independent witness", async () => {
    const deps = adapters();
    const noWitnessQuorum = new TextEncoder().encode(JSON.stringify({ logs: ["log-key"], witnesses: [], witnesses_required: 0 }));
    await expect(prepareSolanaAnchor(new Uint8Array([1]), noWitnessQuorum, {
      verify: deps.verify as never,
      readZip: async () => deps.files,
    })).rejects.toThrow();
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it("rejects a checkpoint note whose tree size differs from the bundle proof", async () => {
    const deps = adapters();
    deps.files.set("proofs/records.json", new TextEncoder().encode(JSON.stringify({ checkpoint: "checkpoints/4.note", tree_size: 5 })));
    await expect(prepareSolanaAnchor(new Uint8Array([1]), trust, {
      verify: deps.verify as never,
      readZip: async () => deps.files,
    })).rejects.toThrow(/tree size/i);
  });
});
