# B3.1C authoritative source-contract closure

## Recommendation

**MINIMAL UPSTREAM SNAPSHOT CHANGE REQUIRED**

Existing `starbase.curAmount` points cannot prove a complete coherent opening inventory. Do not activate the checkpoint.

## Producer evidence

Authoritative producer inspected read-only: `github/SLY-Assistant/SLY_Assistant.user.js` at commit `aaffd2e`.

- `influxStarbaseCargoHold` (around lines 7858–7901) is invoked opportunistically with one starbase cargo hold.
- It throttles independently per starbase to once per 15 minutes (`lastUpdateTimestamp < Date.now() - 60*15*1000`). This is a maximum publication frequency after an invocation, not a guaranteed global cadence.
- It iterates only token accounts returned for that cargo hold and emits one `starbase` line per recognized `cargoItems` mint. This is sparse per visited starbase, not a full profile cycle.
- Existing token accounts with zero balance are emitted as `curAmount=0`; identities with no token account, unrecognized mint, unvisited starbase, failed call, or empty result are absent and indistinguishable.
- Lines have starbase/sector/resource tags only: no faction, player profile, snapshot/run ID, expected row count, completion marker, chain slot, or correction version.
- No timestamp is supplied in line protocol, so Influx assigns server ingestion time (precision is destination configuration/server behavior, not the chain observation context).
- `tokenAmount.uiAmount` is already a JavaScript number. The producer does not retain the raw integer amount/decimals pair in its output, so exact raw decimal quantity is lost before Influx.
- Retries or later invocations can create later points; there is no immutable cycle identity to distinguish correction, duplicate, or a new observation.
- Grouped `last()` selects independently timed rows from different invocations and therefore cannot prove one coherent state.

Recent-data corroboration is **NOT OBSERVED** in this packet: no natural complete cycle identity exists to observe, and samples cannot upgrade the source-code contract into a guarantee.

## Expected identity manifest

No authoritative complete manifest exists in the current producer/output:

- Configured starbases identify possible locations but not every profile-owned cargo pod/token account.
- Static game resources identify possible assets but not whether a token account legitimately does not exist.
- Current sparse producer rows cannot distinguish absent, missing, unknown, or zero except when an existing recognized token account explicitly emits zero.
- Player/profile on-chain inventory could enumerate actual token accounts at one context, but current SLYA publication does not expose a common slot or expected identity set.

## Inventory contract matrix

- Cadence: per-starbase throttle, at most once/15m after invocation; no guaranteed cycle.
- Full/sparse: sparse, one invoked starbase at a time.
- Every identity each cycle: no cycle and no guarantee.
- Zero: explicit only for existing recognized token accounts; absent identity ambiguous.
- Snapshot/run ID: none.
- Completion/expected count: none.
- Timestamp: Influx ingestion time because writer supplies none; not chain observation time.
- Late/corrected/duplicate: possible later points, no classification metadata.
- Coherent grouped `last()`: no.
- Raw decimals: no; producer uses `uiAmount` Number.

## Forward-event contract matrix

- **Scanning:** source transaction has signature/block time, but current ledger adapter consumes mutable UTC-day aggregate (`isoDate → 00:00Z`) and creates derived split rows. Immutable event evidence is not currently retained end-to-end. Current day can change. `>= T` is unsafe from aggregate rows.
- **Mining:** producer write is transaction-triggered but current MSA ledger adapter consumes daily aggregate and assigns UTC midnight. No immutable signature in the ledger event. Current day can change/backfill. Unsafe.
- **Crafting:** MSA has some exact ledger rows with timestamps, but daily joins/aggregates and mutable ingredient/cost enrichment are also used. A stable immutable source identity is not required by the adapter. Unsafe until exact process/transaction identity is mandatory.
- **Cargo:** canonical allocation/cycle data can contain cycle IDs and telemetry timestamps, but current production ledger passes `cargoRows: []`; legacy daily aggregates remain mutable and midnight-derived. Not a complete replay source today.
- **Upgrading:** exact installed telemetry rows carry timestamps, but ledger identity is derived from mutable event content rather than a mandatory transaction/process ID; daily rows can be recomputed. Not yet proven complete.
- **Marketplace LM/GM:** decoded confirmed transactions use signature-based identities and block time; asset flows use `signature:instructionIndex:flow`. These are the strongest immutable sources and can support `>= T`, subject to scanner cursor/backfill completeness and fixed raw-amount precision. Marketplace publication has explicit durable holds/outbox, but that does not make missing historical scans complete.

Mutable daily aggregates are explicitly rejected by the executable contract fixture as immutable event evidence.

## Smallest upstream inventory change

Add one full profile-scoped snapshot publication generated from one consistent RPC context:

1. immutable `snapshotId` (profile + chain context slot/hash);
2. exact `snapshotAt` and `contextSlot`;
3. faction and complete player-profile public key;
4. every configured/authoritative starbase × recognized resource identity, including explicit zero;
5. raw integer amount plus mint decimals (or canonical decimal string derived without `Number`);
6. `expectedRowCount` and one completion marker written only after all rows succeed;
7. deterministic row identity and correction/supersession semantics.

Rows and completion must share `snapshotId`; MSA accepts only a completed exact set. This is smaller and cheaper than introducing an independent MSA RPC crawler, because SLYA already fetches cargo-pod token accounts. No upstream implementation is included here.

## Opening-checkpoint schema impact

Do not revise it yet. Once the upstream contract exists, evolve the checkpoint to hash and persist shared `snapshotId`, `snapshotAt`, `contextSlot`, full profile/faction scope, completion evidence, expected count, and raw exact quantities. Per-row observation timestamps are unnecessary when all rows share the proven immutable snapshot context; until then, `last()` timestamps would have to be persisted but still would not prove completeness.
