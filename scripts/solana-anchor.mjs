import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { signerFromFile } from "@solana/kit-plugin-signer";
import { prepareSolanaAnchor } from "../lib/audit/solana-anchor.ts";

function parseArgs(args) {
  const options = { submit: false, allowMainnet: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--submit") options.submit = true;
    else if (flag === "--allow-mainnet") options.allowMainnet = true;
    else if (["--bundle", "--trust", "--cluster", "--keypair"].includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
      if (flag === "--bundle") options.bundle = value;
      if (flag === "--trust") options.trust = value;
      if (flag === "--cluster") options.cluster = value;
      if (flag === "--keypair") options.keypair = value;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }
  return options;
}

function usage() {
  return "Usage: npm run anchor:solana -- --bundle <tracekit.tkb> --trust <trust.json> [--submit --cluster devnet|mainnet-beta --keypair <solana-keypair.json> [--allow-mainnet]]";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.bundle || !options.trust) throw new Error(usage());
  if (options.submit) {
    if (!options.cluster || !options.keypair || !process.env.SOLANA_ANCHOR_RPC_URL) throw new Error(`Submitting requires --cluster, --keypair and SOLANA_ANCHOR_RPC_URL in the ignored .env file. ${usage()}`);
    if (options.cluster !== "devnet" && options.cluster !== "mainnet-beta") throw new Error("Cluster must be devnet or mainnet-beta.");
    if (options.cluster === "mainnet-beta" && !options.allowMainnet) throw new Error("Mainnet submission requires the explicit --allow-mainnet flag.");
    if (options.cluster === "devnet" && options.allowMainnet) throw new Error("--allow-mainnet can only be used with mainnet-beta.");
  } else if (options.allowMainnet) {
    throw new Error("--allow-mainnet requires --submit.");
  }

  let bundle;
  let trust;
  try {
    bundle = new Uint8Array(await readFile(resolve(options.bundle)));
    trust = new Uint8Array(await readFile(resolve(options.trust)));
  } catch {
    throw new Error("Could not read the bundle or trust file. Check local paths; path details were suppressed.");
  }
  const anchor = await prepareSolanaAnchor(bundle, trust);
  if (!options.submit) {
    process.stdout.write(`Validated witnessed checkpoint. Dry run memo: ${anchor.memo}\n`);
    return;
  }

  // Deliberately isolated in this opt-in CLI. No application/refill path calls this publisher.
  try {
    const client = await createClient()
      .use(signerFromFile(resolve(options.keypair)))
      .use(solanaRpc({ rpcUrl: process.env.SOLANA_ANCHOR_RPC_URL }));
    const result = await client.sendTransaction([getAddMemoInstruction({ memo: anchor.memo })]);
    process.stdout.write(`Anchored witnessed checkpoint on ${options.cluster}: ${result.context.signature}\n`);
  } catch {
    // SDK and RPC errors can echo credential-bearing URLs; keep those out of console and captured sessions.
    throw new Error("Solana submission failed. Check RPC and signer configuration locally; sensitive error details were suppressed.");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Solana anchor failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
