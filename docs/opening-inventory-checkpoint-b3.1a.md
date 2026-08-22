# B3.1A opening-inventory checkpoint foundation

This module is intentionally not imported by production. It creates a tested persistence boundary only.

## Schema v1

Path: `<userData>/opening-inventory/<faction>/<sha256(playerProfile)[0:24]>/opening-inventory-v1.json`.

Fields:

- `schemaVersion`: `1`
- `faction`: exact scope
- `playerProfile`: actual profile identity
- `sourceTimestamp`: canonical UTC inventory observation time
- `eventBoundaryTimestamp`: exactly the source timestamp; future event replay starts strictly at this declared boundary according to B3.1B cutover semantics
- `sourceType`: `current-inventory-snapshot`
- `rows[]`: sorted `{ location, asset, quantity, costCoverage: "uncosted", status: "Incomplete" }`
- `contentHash`: SHA-256 of deterministic scope/source/rows content (creation time excluded)
- `createdAt`: canonical UTC persistence time

Quantities are positive canonical decimal strings, not JavaScript numbers. Scientific notation, numeric JSON values, zero, negatives, missing and non-finite representations are rejected. This preserves tiny fractions for the later fixed-point boundary. Duplicate location/asset rows are rejected rather than merged.

## Storage behavior

- Per-document in-process queue plus `proper-lockfile` cross-process lock serializes writers.
- `writeJsonAtomic` writes mode `0600`, fsyncs the temporary file, and renames atomically.
- An injected pre-rename/interrupted write leaves the previous document byte-identical and recoverable.
- Existing corrupt, unsupported, hash-invalid or malformed state returns `invalid`, remains untouched, and blocks replacement.
- Exact repeated content returns `loaded` without rewriting or changing `createdAt`.
- Different faction/profile scopes resolve to separate paths. A valid document copied into the wrong scope returns `scope-mismatch`.
- Public lifecycle statuses are `missing`, `loaded`, `invalid`, `scope-mismatch`, `created`, and `save-failed`.
- Unknown caller properties are not persisted. There are no credentials, endpoint, current-price, cost, or unrelated-setting fields.

## Existing `ledger-checkpoint.js` interaction

The existing ledger checkpoint stores the mutable accumulated `InventoryCostLedger`, replay fingerprints/results, faction/profile alias and save time. On a missing ledger checkpoint, production currently queries opening quantities from Influx `-38d..-31d`, turns them into uncosted acquisitions, applies later events, then saves the resulting mutable ledger checkpoint.

B3.1A neither reads nor writes that checkpoint and does not change its schema, path, query, calculations, or runtime lifecycle.

## Proposed B3.1B cutover (not implemented)

1. Resolve the actual selected player-profile public key and faction before Break-even ledger work.
2. Load schema-v1 opening checkpoint for that exact scope.
3. If `loaded`, convert decimal quantity strings through the future precision boundary, create uncosted opening lots at `eventBoundaryTimestamp`, and admit only source events on the explicitly chosen non-overlapping side of that boundary.
4. If `missing`, fetch one authoritative current inventory snapshot, preserving raw decimal quantity strings and source timestamp; validate and save it first. Only after a successful durable save may it seed a new ledger.
5. If `invalid`, `scope-mismatch`, or `save-failed`, report opening baseline unavailable/Incomplete and do not fall back to fabricated zero, current prices, or a destructive overwrite.
6. Keep the existing ledger checkpoint separate during one compatibility release. Bind its metadata to the opening checkpoint `contentHash` and event boundary before accepting it; otherwise rebuild safely from the opening checkpoint plus post-boundary immutable events.
7. Remove the `-38d..-31d` query only after targeted migration tests prove restart idempotency, boundary exclusivity, scope isolation and existing-checkpoint compatibility.

Remaining cutover risks: defining inclusive/exclusive timestamp behavior for same-timestamp events, obtaining raw decimal quantities without an earlier `Number` conversion, binding old mutable ledger checkpoints safely, and coordinating this boundary with immutable source identities and later fixed-point arithmetic.
