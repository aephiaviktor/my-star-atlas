# B3.2D durable immutable event store

Foundation-only store at `<root>/immutable-events/<faction>/<complete-profile-fingerprint>/immutable-event-store-v1.json`. Schema v1 binds faction, complete player-profile identity, deterministic SHA-256 profile fingerprint, creation time, event/conflict/coverage/replay collections, and deterministic content hash.

Mutations serialize through a per-document in-process queue and `proper-lockfile` cross-process lock. Existing `writeJsonAtomic` provides mode-0600 temporary writes, fsync, atomic rename, and directory durability. Invalid, unsupported, scope-mismatched, or hash-invalid state is preserved and blocks overwrite.

Admission is append-only: new identity/payload is accepted; exact replay causes no rewrite; changed payload records a bounded idempotent conflict while preserving the canonical event. Identifiable incomplete events are retained with `eligibility: Incomplete`. Evidence without valid identity is excluded from events and belongs in coverage.

Corrections are immutable events with distinct revision identity and explicit `supersedes`. They require an existing same-scope/source/kind predecessor, distinct slot/revision, one compatible successor, and an acyclic chain. Effective resolution walks the chain without rewriting history.

Coverage is independent of event validity. A complete record may explicitly supersede an incomplete record only for an identical requested range. Both audit records remain stored; events never imply coverage completeness.

Growth is append-only and proportional to unique accepted events, unique conflicts, admission decisions, and scans. Exact replays are byte-identical, create no persisted replay/audit entry, and cause no storage growth. The smallest future compaction is a separately hashed immutable segment/archive manifest plus a small active head; never delete canonical history or collapse unresolved conflicts/correction chains.
