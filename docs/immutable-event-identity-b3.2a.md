# B3.2A immutable event identity contract

Foundation only. `immutable-event-identity.js` has no production import or call site.

## Envelope v1

Identity fields are schema version, event kind, source system, immutable source-native identity, faction, complete player profile, and optional immutable revision. Their deterministic hash is `eventId`. Payload fields are exact source event timestamp, optional location identity, mint/asset identity, exact quantity (`rawAmount`, decimals, canonical decimal), immutable provenance, and optional `supersedes`; their separate deterministic hash is `payloadHash`.

Identity excludes mutable aggregates, prices, recomputed fees, display names, ingestion time, meaningless array position, and whole mutable payload fingerprints. Exact quantities and future monetary boundary values remain decimal strings.

## Replay

Exact duplicate identity+payload is accepted once. Same event ID with another payload hash is a conflict. Equal timestamps do not merge distinct identities. Late events retain source time and identity. Corrections require a new immutable revision/source identity plus `supersedes`; history is retained. Scope is faction+complete profile. Events before opening boundary are excluded; events exactly at it are included. Any unsupported source makes coverage `Incomplete`, never zero-cost.

## Source matrix

- **Scanning — UNSUPPORTED.** Current adapter consumes mutable daily SDU totals and synthesizes UTC-midnight timestamps. Immutable scan transaction signature/instruction index and exact raw amount are discarded. Minimum upstream addition: signature, scan instruction/flow index, block time, raw amount/decimals, faction/profile.
- **Mining — UNSUPPORTED.** Current adapter consumes mutable daily resource totals; transaction identity and exact source timestamp are lost. Minimum: mining claim/stop signature plus resource flow index, block time, raw amount/decimals, faction/profile.
- **Crafting — PROVISIONAL.** Crafting process/job accounts and timestamps exist, but current production rows do not consistently preserve immutable process identity plus source step and exact raw amounts. Minimum: process account/job ID, immutable step/output identity, transaction signature where applicable, block time, raw amount/decimals.
- **Cargo — PROVISIONAL.** Canonical `cycleId` survives and can combine with immutable leg/resource mint/allocation identity. Completeness and correction semantics across cycle telemetry are not yet proven. Preserve cycle ID, leg identity, resource mint, allocation index, source event time, and exact amount.
- **Upgrading — PROVISIONAL.** Operation/process accounts and exact telemetry times exist, but production consumption rows do not guarantee immutable operation+step identity. Minimum: upgrade process/operation account, submission step/resource identity, signature/block time, raw amount/decimals.
- **Local Market — SUPPORTED at scanner source, provisional in production adapter.** Confirmed transaction signature, instruction/asset-flow index, block time and raw mint are available. Identity is signature+source-meaningful instruction/flow index; adapters must preserve exact quantity and full scope.
- **Galactic Marketplace — SUPPORTED at scanner source, provisional in production adapter.** Confirmed execution signature plus instruction/asset-flow index and block time are available. Same preservation requirements as LM.

`SUPPORTED` means a source-native immutable identity exists. It does not claim complete backfill coverage. `PROVISIONAL` means a plausible native identity exists but end-to-end preservation/completeness is unproven. `UNSUPPORTED` means current evidence is only mutable aggregate data.

## Deferred opening activation

Future activation requires separate authorization: briefly pause USTUR1 and USTUR2, take two complete profile-wide captures, require matching manifest/registry/quantity hashes and no relevant operation between captures, persist and verify the checkpoint, then resume. This packet performs no cutover.
