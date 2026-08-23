# B3.3D isolated exact shadow projection

The shadow projector is pure orchestration over validated exact opening evidence, immutable events, the exact ledger, and exact checkpoint. It has no production import, startup hook, scanner, UI, RPC, Influx, or legacy-state mutation.

Cold replay validates opening scope/hash/boundary, resolves correction chains, sorts effective events by authoritative timestamp then event ID, skips unsupported accounting sources without inventing zero cost, applies supported events atomically, and persists schema-v2 checkpoint state. Restart loads unchanged state without rewrite. Compatible append advancement restores only a validated exact checkpoint and applies new IDs once. Corrections, coverage improvements, changed/missing events, or binding/version failures require rebuild; historical lots are never patched.

Relevant conflicts make projection Incomplete and block cutover. Unrelated conflicts remain REVIEW evidence. Incomplete eligibility or coverage propagates Incomplete. Cross-scope event-store content is rejected.

Legacy comparison is isolated and reports `PASS`, `REVIEW — EXPECTED EXACTNESS DIFFERENCE`, `REVIEW — COVERAGE DIFFERENCE`, or `BLOCK — INVARIANT DIFFERENCE`. Exact values remain exact; ratio comparison renders both sides through the fixed-point boundary rather than importing legacy floats into the ledger. Quantity, Base/Cargo/Total, C/U, COGS, ending basis, and status are compared when present.

The twelve readiness gates are opening snapshot, forward boundary, identity support, backfill coverage, relevant conflicts, corrections, execution/custody attribution, currency/units, checkpoint currency, reconciliation, deterministic replay, and no legacy mixing. Current evidence remains `NOT READY`: Scanning and Mining are unsupported; Crafting, Cargo, and Upgrading are provisional; LM/GM are conditional on complete evidence and custody attribution; opening activation is deferred.
