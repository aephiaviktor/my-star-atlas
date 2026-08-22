# B3.1B opening-inventory shadow boundary

## Status

Shadow-only and disabled by default. `opening-inventory-shadow.js` is not imported by `main.js`, preload, renderer, or any user-visible calculation. It cannot create an operator checkpoint merely because the application starts.

## Exact UTC boundary

For a boundary `T`, `T` must be canonical UTC midnight (`YYYY-MM-DDT00:00:00.000Z`). A pending bootstrap chooses the next such midnight. The inventory Flux adapter emits an exclusive `stop: T`; every accepted observation has `_time < T`. The forward filter is exactly `timestamp >= T`. Consequently an event immediately before `T` is excluded, while one exactly at or after `T` belongs only to forward replay. Mid-day cutovers are rejected.

## Actual source and cadence finding

The existing source is Influx measurement `starbase`, field `curAmount`, grouped by `rss` and `starbase`, using each group’s `last()` point. The current production adapter converts `_value` through `Number`, silently skips malformed rows, and uses a relative `-38d..-31d` interval; it cannot satisfy this contract unchanged.

Repository code and tests specify no authoritative writer cadence, expected identity manifest, completeness marker, snapshot transaction ID, or proof that all starbase/resource groups were observed coherently. Timestamps are per row and may differ. Therefore cadence and freshness **cannot currently be proven** from the repository. B3.1B does not select a tolerance. The shadow adapter returns `freshness-unproven` unless a future caller supplies an independently proven policy, and returns `completeness-unproven` unless supplied an authoritative exact identity set.

This is a scoped activation blocker, not a reason to guess. B3.1C must identify and verify the upstream writer contract before enabling checkpoint creation.

## Raw adapter behavior

Raw `_value` must be a positive plain-decimal string. It is canonicalized as text and never passed through JavaScript `Number`; tiny fractions remain exact. Every adapted row retains its exact canonical UTC `_time`. Missing scope, query failure, absent completeness proof, partial/unknown/duplicate identities, malformed quantity/time, observations at/after `T`, stale observations, and unproven freshness all produce explicit unavailable results. No stale rows are carried forward.

The adapter and checkpoint allowlist contain no prices, costs, endpoints, credentials, or tokens.

## Two-phase coordinator

1. `pendingBootstrap` records exact faction, complete player-profile identity, and next UTC midnight.
2. Before `T`, it remains pending.
3. At/after `T`, an explicitly enabled shadow invocation validates raw observations against scope, boundary, freshness and exact identity completeness.
4. It atomically creates or idempotently loads the B3.1A checkpoint.
5. It returns the exact forward filter descriptor `{ field: "timestamp", operator: ">=", value: T }`.

Default invocation returns `disabled`. There is no scheduler or runtime call site in this packet.

## Ledger-checkpoint successor binding

Proposed mutable ledger schema v2 retains the existing v1 ledger/replay payload and adds mandatory:

- `schemaVersion: 2`
- `openingCheckpointHash`
- `forwardEventBoundary`
- `faction`
- complete `playerProfile`

A v1 or absent document is `legacy-unbound`. A v2 document is compatible only when all four binding values match exactly. Missing fields or unsupported schema are unavailable; hash, boundary, faction, or profile mismatch is `rebuild-required`. Classification is pure and does not rewrite the existing live checkpoint. Persistence migration and production reuse remain for B3.1C or later.

## Remaining B3.1C blockers

- Prove the upstream `starbase.curAmount` writer cadence and define a justified freshness tolerance.
- Provide an authoritative expected identity/completeness manifest for the selected faction/profile, including the treatment of zero-balance identities.
- Confirm aggregate forward-event timestamps are authoritative at the UTC boundary; daily-derived timestamps alone must not be assumed sufficient.
- Decide how per-row observation timestamps are durably represented if audit requirements require them beyond adapter validation (B3.1A stores one checkpoint source timestamp plus the deterministic row set).
- Implement and migrate ledger schema v2 only after those proofs; never auto-trust or overwrite v1.
