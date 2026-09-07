# Toolkit downtime validation (separate from charts)

The upper Selection Uplift and UTC-Calendar Crew-State Utilization charts and calculation module are restored to **v0.6.285**. Axis navigation remains as in that version. Toolkit evidence and estimates do not modify chart inputs, productive work, claim lock, or configured capacity. The v0.6.286/287 supply-adjusted chart model is removed.

## Validation table

A compact, scrollable table in OP / Upgrading Analytics reports the selected faction's PHANTOM starbase, newest UTC date first, within the requested window and rolling 30-day boundary (not before August 14). Today contains elapsed time only.

- Covered: seconds supported by same-day account-clock windows or reconciled binary Toolkit intervals, with duplicate overlaps counted once.
- Toolkit Downtime: stopped seconds within covered time. No coverage displays `--`, not zero.
- Unknown: uncovered or conflicting seconds. Conflicting segments do not discard other segments in the diagnostic projection.
- Estimated Total: only for partial days with coverage, covered downtime / covered seconds × elapsed selected day seconds. This explicitly labelled same-day extrapolation may be unreliable with sparse coverage. It is not measured downtime and is never persisted as evidence. Without coverage there is no estimate; unknown time is still reported.
- Evidence: Account clock (optionally partial), Reconciled, Partial · estimate, or Not observed. Reconciled describes internal replay consistency, **not** independent real-world validation.

Table sync errors do not invalidate chart calculations. Existing acquisition is reused with no new RPC queries or timers. Independent local clock-observation storage is described below.

## Retained measurement path

Upgrading uses the Toolkit stop clock: full speed with upkeep, stopped while depleted. Zero reserve disables upkeep. Crafting's Food slowdown is not used.

Finalized Game, GameState, Starbase and chain Clock are read from one bank. Resumable scans have fixed target slots; newer transactions wait for the next window. Same-slot deposits use block transaction order and instruction execution order. Reconciliation checks balance and accumulated Toolkit-local time. The bounded scan saves progress locally, with publication before anchor advancement.

Canonical snapshots and replenishments remain in the JSON `record` field of `starbase_upkeep_state`, tagged `model=toolkit-stop-v2`. Hourly evidence uses the same model tag. Legacy slowdown records are excluded. Recovery state remains in the application's user-data directory under `starbase-upkeep-v2`, with five 1,000-signature pages per refresh and 35-day retention. A first capture is a baseline, not historical backfill.

## Verification still needed

The public mainnet fixture validates SAGE2 layout, finalized slot, PHANTOM identities and the captured 77 units/second rate. It does **not** validate a historical on-chain shortage/refill interval. Compare a known shortage/replenishment period against the account clock and transaction evidence before applying downtime to chart capacity again. Automated replay and table tests are not substitutes for that validation.

## Independent account-clock measurements (local follow-up to v0.6.289)

A fresh finalized snapshot is now captured before reading replay history. A separate
local `.json.observations` journal retains scoped snapshot pairs for 35 days. It
is saved independently of Influx reads/publication and transaction replay. No
additional RPC calls or timer are added: each existing Analytics acquisition uses
one snapshot for both paths. A failed capture retains previously measured windows;
a failed comparison skips only that pair and starts the next pair from the new
observation. Local write failures are visible and do not hide an in-memory result.

For compatible snapshots (same faction, PHANTOM address, tier, reserve and rate):

`stopped seconds = elapsed chain time - change in projected Toolkit-local time`

Projection uses the integer SDK stop clock, not crafting's slowdown. Negative or
above-elapsed clock differences are rejected. This assumes the upkeep configuration
did not change between captures; equal endpoint configuration cannot exclude an
intermediate configuration change. This is an account-clock measurement, not an
independently verified refill timeline.

Same-day windows wholly inside the selected period populate Covered and Toolkit
Downtime. Detailed replay outside those windows remains included; overlapping replay
is not counted twice. A window crossing midnight or a date filter is not prorated
into measured daily downtime. Its existence is disclosed, and the latest clock
window's full timestamps and stopped total are shown separately in the status.
The existing same-day Estimated Total remains explicitly extrapolated, not measured.

Errors now identify account capture, history read, transaction replay or history
publication with safe messages. HTTP write status codes are preserved (the former
letters-only filter hid them). Raw transport errors, URLs and credentials are not
sent to the renderer. The specific error on Viktor's desktop has not been observed
on this host: no desktop Toolkit journal was available here.

### Public-chain verification, 2026-09-07

The two committed public fixtures contain finalized bank snapshots at slots
445054254 and 445126813, 11:29:52–17:53:16 UTC (23,004 seconds). Both raw account
sets decode to their saved normalized values. Projecting each with the SDK's
`calculateCurrentResourceTimeStop` independently agrees with our clock comparison:

- MUD: 19,577 active seconds; **3,427 stopped seconds (57m 7s)**.
- ONI: 23,004 active seconds; **0 stopped seconds**.
- USTUR: 23,004 active seconds; **0 stopped seconds**.

This validates a nonzero real-account window total. Exact shortage/refill boundaries
and transaction-by-transaction reconciliation still need independent validation.
No live application or Influx data was changed to obtain these fixtures.

The charts and calculation module remain unchanged. Summary copy now explicitly
calls claim lock estimated (Toolkit pauses can inflate it), and the operational
summary is named Feasible-Neutral Capacity Range rather than implying an ATLAS result.
