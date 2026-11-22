import { readZip, verify } from "@cygnuxlabs/tracekit/verify";

type Verification = Awaited<ReturnType<typeof verify>>;
type Dependencies = {
  verify?: (bundle: Uint8Array, trust: Uint8Array) => Promise<Verification>;
  readZip?: typeof readZip;
};

export type SolanaAnchor = {
  treeSize: number;
  rootHex: string;
  memo: string;
};

function parseTrust(trustBytes: Uint8Array): { witnesses: { class: string }[]; witnesses_required: number } {
  let trust: unknown;
  try {
    trust = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(trustBytes));
  } catch {
    throw new Error("Trust configuration is not valid JSON.");
  }
  if (!trust || typeof trust !== "object") throw new Error("Trust configuration is invalid.");
  const value = trust as { witnesses?: unknown; witnesses_required?: unknown };
  if (!Array.isArray(value.witnesses) || !Number.isSafeInteger(value.witnesses_required) || Number(value.witnesses_required) < 1) {
    throw new Error("Solana anchoring requires a configured witness quorum.");
  }
  const independent = value.witnesses.some((w) => !!w && typeof w === "object" && (w as { class?: unknown }).class !== "operator");
  if (!independent) throw new Error("Solana anchoring requires at least one independently operated witness.");
  return value as { witnesses: { class: string }[]; witnesses_required: number };
}

function proofMetadata(files: Map<string, Uint8Array>): { treeSize: number; rootHex: string } {
  const proofBytes = files.get("proofs/records.json");
  if (!proofBytes) throw new Error("Bundle has no records checkpoint proof.");
  let proof: unknown;
  try {
    proof = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(proofBytes));
  } catch {
    throw new Error("Bundle checkpoint proof is invalid.");
  }
  if (!proof || typeof proof !== "object") throw new Error("Bundle checkpoint proof is invalid.");
  const { checkpoint, tree_size: treeSize } = proof as { checkpoint?: unknown; tree_size?: unknown };
  if (!Number.isSafeInteger(treeSize) || Number(treeSize) < 2 || typeof checkpoint !== "string" || !/^checkpoints\/[1-9][0-9]*\.note$/.test(checkpoint)) {
    throw new Error("Bundle checkpoint must reference a batch of at least two records.");
  }
  const noteBytes = files.get(checkpoint);
  if (!noteBytes) throw new Error("Bundle checkpoint note is missing.");
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(noteBytes).split("\n");
  const noteSize = lines[1];
  if (noteSize !== String(treeSize)) throw new Error("Checkpoint note and proof tree sizes do not match.");
  const encodedRoot = lines[2];
  if (!encodedRoot || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedRoot)) {
    throw new Error("Checkpoint root is invalid.");
  }
  const root = Buffer.from(encodedRoot, "base64");
  if (root.length !== 32 || root.toString("base64") !== encodedRoot) throw new Error("Checkpoint root is invalid.");
  return { treeSize: Number(treeSize), rootHex: root.toString("hex") };
}

/** Verify a Tracekit bundle locally and produce the only data this publisher may put on-chain. */
export async function prepareSolanaAnchor(bundle: Uint8Array, trustBytes: Uint8Array, dependencies: Dependencies = {}): Promise<SolanaAnchor> {
  parseTrust(trustBytes);
  const result = await (dependencies.verify ?? verify)(bundle, trustBytes);
  if (result.code !== 0 || result.report.integrity !== "VERIFIED" || !result.report.assurance.startsWith("witnessed")) {
    throw new Error("Bundle verification failed or the checkpoint is not independently witnessed.");
  }
  const files = await (dependencies.readZip ?? readZip)(bundle);
  const checkpoint = proofMetadata(files);
  return {
    ...checkpoint,
    memo: `refill-guard.tracekit.v1|${checkpoint.treeSize}|${checkpoint.rootHex}`,
  };
}
