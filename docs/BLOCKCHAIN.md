# Blockchain and Solana in Aegis

This document explains the optional Solana anchor in Aegis, what it is for, what it exposes, and what we can accurately say in a demo or Devpost submission.

## In one sentence

Aegis keeps refill decisions and healthcare data in its application and database; an operator may separately publish a verified, independently witnessed Tracekit batch checkpoint to Solana as a public timestamped commitment. Solana never approves, denies, or changes a refill.

## Why use a blockchain here?

A public chain can give an independently inspectable timestamp for a batch commitment. Someone who receives the original Tracekit bundle and the pinned verification trust can verify that the bundle matches the checkpoint that was anchored. That can make later alteration of the represented batch detectable, subject to the signing keys, witness, verifier, and trust configuration being sound.

The chain is useful as an optional transparency and audit aid. It is not the pharmacy database, a backup for patient records, an access-control system, proof of clinical correctness, or a source of truth for order state. A blockchain entry cannot prove that a pharmacist made the right decision or that a spoken statement was clinically correct.

## How the anchor works

1. **The application remains authoritative.** The agent can act only through its twelve contract buttons and the control layer. The control layer applies the refill rules; speech is checked by the speech guard. Pharmacist decisions are made in the application. Solana is not called by those flows.
2. **Tracekit supplies signed audit evidence.** The application integration requires a configured signer. A Tracekit export bundles records and the checkpoint proof. An independently operated witness must cosign the checkpoint, and the operator must hold the corresponding pinned trust configuration out of band.
3. **The operator verifies before publishing.** `npm run anchor:solana -- --bundle <tracekit.tkb> --trust <pinned-trust.json>` verifies the bundle locally. It refuses to prepare an anchor unless verification succeeds, the checkpoint has independently witnessed assurance, the trust requires a witness quorum, and the checkpoint covers at least two records.
4. **Solana receives only a commitment.** The CLI builds an SPL Memo containing `refill-guard.tracekit.v1|<tree-size>|<root-hex>`. The memo contains no patient, prescription, refill, call, transcript, tool argument, or leaf data. The transaction signature and ledger position provide public timestamp evidence.
5. **The anchor is out of band.** Dry-run is the default. An operator must opt in with `--submit` and select a cluster. Mainnet additionally requires `--allow-mainnet`. A failed submission ends the CLI command; it cannot block or alter an application decision.

This uses Solana's Memo instruction, not an Aegis smart contract or custom token. See the [Solana Kit client guide](https://solana.com/docs/frontend/client), [Memo program](https://github.com/solana-program/memo), and [transaction model](https://solana.com/docs/core/transactions).

## What is public

Solana transaction and instruction data are public. An anchor exposes:

- The Aegis memo format/version, Merkle root, and tree size.
- The transaction signature, ledger position/time, and fee-payer address.
- The fact and timing of each published anchor. Batching reduces per-record timing disclosure, but does not remove timing or activity metadata.

A Merkle root is a commitment, not encryption or anonymization. It cannot be used to retrieve the underlying records, but it may confirm that a known candidate batch matches a published root. Do not anchor small or predictable sensitive datasets, and do not treat a root as a safe replacement for de-identification. Keep all patient and order content off-chain.

Use a dedicated anchor payer address; do not reuse a personal wallet. Production signing should use a KMS, HSM, or managed signer rather than a long-lived raw keypair. Solana's [production signing guidance](https://solana.com/docs/core/transactions/signing-in-production) describes the available custody approaches.

## Current implementation and demo readiness

**Implemented in this branch:** a standalone CLI; local Tracekit bundle and witness verification; a minimal memo format; explicit dry-run and submit modes; a mainnet confirmation flag; and tests for witness, integrity, batch-size, and memo-content gates. The live refill app does not call the CLI or read Solana state.

**Not yet demonstrated or configured:** no production Tracekit signer, independent witness, pinned production trust file, RPC credential, or Solana transaction has been configured or exercised by this work. The code supports an opt-in transaction path, but do not say that Aegis has written an on-chain record until a real synthetic-data transaction has been sent and independently checked.

For a demo that includes a real anchor:

1. Use only synthetic patients and orders.
2. Configure an approved Tracekit signer and a witness operated independently from the signer. Obtain and verify the trust pins out of band.
3. Export a batch checkpoint and verify it locally with the pinned trust file.
4. First run the CLI without `--submit`; inspect the memo and confirm that it contains only the version, tree size, and root.
5. For a network demonstration, use devnet, an isolated demo payer, and a protected RPC URL in the ignored `.env` as `SOLANA_ANCHOR_RPC_URL`. Submit only after confirming the selected cluster and synthetic bundle.
6. Check the transaction and memo in a Solana explorer. Separately verify the Tracekit bundle against the pinned trust. Do not imply that the explorer can show refill contents or prove the clinical decision.

The operator's keypair path is passed as `--keypair`; never pass key contents in a command, add keys or trust pins to the repository, or put patient data in a memo. For production, use managed signing instead of the CLI's local-keypair flow.

## Demo narration

> Refill decisions stay inside Aegis's rules and pharmacist workflow. Separately, after an audit batch is signed and independently witnessed, an operator can verify it and publish a Merkle commitment to Solana. The public chain shows the checkpoint and when it was anchored; it does not receive patient or order data, and it has no authority over a refill.

Use this narration for a live on-chain demo only after the demo checklist succeeds. Until then, describe the publisher as implemented but not yet exercised against Solana.

## Devpost copy

### Accurate with the current evidence

> Aegis includes an optional Solana anchoring tool for audit transparency. The tool verifies a Tracekit checkpoint against pinned trust and publishes only a batched Merkle root and its tree-size/version metadata in a public Memo transaction. Patient and order details remain off-chain, and Solana has no role in refill decisions. The publisher is implemented; a live Solana transaction has not yet been demonstrated.

### Replace the final sentence only after a real demo

After sending and checking a synthetic-data devnet transaction, replace the final sentence with a factual description of that run. State the cluster and link to the transaction only if the transaction was actually verified. Do not describe devnet as mainnet or claim a production deployment, healthcare compliance, immutable patient records, or blockchain-controlled approvals.

## Related implementation notes

- [Tracekit signed actions and Solana CLI](TRACEKIT.md)
- [Aegis product and safety rules](SPEC.md)
- [Solana signing in production](https://solana.com/docs/core/transactions/signing-in-production)
