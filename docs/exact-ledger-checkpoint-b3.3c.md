# B3.3C exact-ledger checkpoint

Schema v2 is isolated at `<root>/exact-ledger-checkpoints/<faction>/<full-profile-fingerprint>/exact-ledger-checkpoint-v2.json`. It never reads, overwrites, converts, or reinterprets legacy numeric checkpoint v1.

The document binds exact-arithmetic and ledger-engine versions, complete faction/profile scope and SHA-256 fingerprint, opening checkpoint ID/hash, exact forward boundary, immutable-event-store version/hash, applied event IDs/payload hashes, canonical exact lots and Base/Cargo/Total components, coverage, timestamps, and deterministic content hash.

Load validates scope and opening bindings, supported versions, canonical units and coefficients, component conservation, and content hash. Existing applied events must remain present and byte-hash-equivalent. Missing/changed applied events, corrections, and coverage improvements require rebuild. Compatible appends require deterministic advance. Appended conflicts retain the checkpoint but readiness is Incomplete.

Writes are queued in-process and locked cross-process. Temporary files use mode 0600, are fsynced, atomically renamed, and followed by target and directory fsync. Corrupt/unsupported state is preserved and blocks overwrite. Semantic replay returns `no-change` without rewriting bytes.

Exact persistence remains production-unreferenced. B3.3D must add an isolated shadow projector, deterministic advancement, comparison reports, and readiness/cutover gates.
