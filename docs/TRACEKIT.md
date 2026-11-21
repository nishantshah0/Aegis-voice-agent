# Tracekit signed actions

The live model path passes each of the twelve contract buttons through Tracekit v2 before `control.press`. The control layer still validates identity, refill rules, and all side effects. A pharmacist decision is separately authorized as `pharmacist_decision` before `Store.decide`; its run and decision IDs are stored in the same approval record as the queue/order transaction. Pharmacist queue and phone events publish only after Tracekit acknowledges the committed result.

The SDK is experimental (`@cygnuxlabs/tracekit` 1.7.2). Review its [TypeScript SDK contract](https://github.com/Cygnux-Labs/Tracekit/blob/main/sdk/typescript/README.md) before upgrades. The app requires an explicit `TRACEKIT_SIGNER`; production accepts only an HTTPS signer URL. The SDK also supports token or mTLS authentication through `TRACEKIT_SIGNER_TOKEN_FILE`, `TRACEKIT_API_KEY`, `TRACEKIT_SIGNER_CERT`, `TRACEKIT_SIGNER_KEY`, and `TRACEKIT_SIGNER_CA`. Keep credentials in the deployment secret manager or ignored `.env` file. Never add them to source, fixtures, logs, or this document. The same-user development signer fallback is intentionally not used by the live app.

The signer policy must:

- Allow only the twelve exact names in `BUTTON_NAMES` plus `pharmacist_decision`.
- Deny unknown tools and never use an unavailable/fail-open decision to execute an action. The app enforces fail-closed behavior even if the signer returns an allow marked unavailable.
- Keep the lock's identity and clinical checks authoritative. Tracekit policy adds a signed authorization gate; it does not replace the lock.
- Treat tool arguments as potentially containing health information. The signer endpoint must be approved to process that data and protected accordingly.

Completion events contain an `argsDigest` commitment, not the pharmacy result, patient-facing text, note, or approver identity. The approval record holds the signer run ID, policy decision ID, and rule IDs in the existing local hash chain.

## Witnessing and verification

The application integration does not provision a witness or claim that a run is independently witnessed. Configure a customer or public witness only when it is operated by an independent party on a separately administered host; a same-host cosigner is not independent. Witnesses receive checkpoints, not pharmacy results. Pin the independently supplied verification trust configuration out of band, export a run bundle, and verify it with the Tracekit verifier before treating it as independently witnessed.

## Optional Solana public anchor

Solana is only an optional, asynchronous public anchor for already-batched Tracekit Merkle checkpoints. Anchor a checkpoint only after Tracekit has signed it and the independent witness has cosigned it. The chain is not part of the refill path: no API, control rule, retry, or spoken status reads an on-chain value, and an unavailable RPC or failed transaction must never block or change a refill decision.

Publish only the batched Merkle root (and the minimum tree-size/version metadata needed to verify the checkpoint). Keep patient, order, prescription, call, tool-argument, and leaf data off-chain. A transaction signature/ledger position is the public timestamp evidence; do not include patient or order identifiers in memos, account seeds, program accounts, or logs. Solana transactions and instruction data are public, so the root is a commitment for later verification, not encryption. Batch before anchoring to reduce per-action timing disclosure. See Solana's [transaction model](https://solana.com/docs/core/transactions).

This branch does not include a Solana program, RPC publisher, wallet, or transaction submission. Add that as a separate opt-in checkpoint-export worker once the Tracekit checkpoint feed, program or memo format, RPC provider, and key custody are selected. It must consume only signed, witnessed batch checkpoints and fail independently of the live app.

## Failure behavior

- Signer unavailable or decision failure: record a local blocked safety entry and do not execute the button or pharmacist decision.
- Policy deny/ask: do not execute the button or decision.
- Result completion missing after an already committed button action: withhold the model's success result. The database and refresh-cue events may already reflect the committed action; refresh authoritative state before any further action. Do not retry the action blindly. For a pharmacist decision, the route also withholds queue and phone events until signing succeeds.
- Tests use a deterministic in-process signer stub only when `NODE_ENV=test`; it is not used by development or production application traffic.

For local inspection after configuring an actual signer, follow the SDK guide for its export and verification commands. This repository does not store signer keys, witness keys, trust pins, or real patient data.
