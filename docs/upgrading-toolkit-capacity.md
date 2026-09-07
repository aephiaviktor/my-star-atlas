# Toolkit downtime validation (separate from charts)

The upper Selection Uplift and UTC-Calendar Crew-State Utilization charts, their summaries, and calculation module are restored to **v0.6.285**. Axis navigation remains as in that version. Toolkit evidence and estimates do not modify chart inputs, productive work, claim lock, or configured capacity. The v0.6.286/287 supply-adjusted chart model is removed.

## Validation table

A compact, scrollable table in OP / Upgrading Analytics reports the selected faction's PHANTOM starbase, newest UTC date first, within the requested window and rolling 30-day boundary (not before August 14). Today contains elapsed time only.

- Covered: seconds supported by reconciled binary Toolkit intervals, with duplicate overlaps counted once.
- Toolkit Downtime: stopped seconds within covered time. No coverage displays `--`, not zero.
- Unknown: uncovered or conflicting seconds. Conflicting segments do not discard other segments in the diagnostic projection.
- Estimated Total: only for partial days with coverage, covered downtime / covered seconds × elapsed selected day seconds. This explicitly labelled same-day extrapolation may be unreliable with sparse coverage. It is not measured downtime and is never persisted as evidence. Without coverage there is no estimate; unknown time is still reported.
- Evidence: Reconciled, Partial · estimate, or Not observed. Reconciled describes internal replay consistency, **not** independent real-world validation.

Table sync errors do not invalidate chart calculations. Existing acquisition is reused; no new RPC queries, timers, or history stores were introduced for the table.

## Retained measurement path

Upgrading uses the Toolkit stop clock: full speed with upkeep, stopped while depleted. Zero reserve disables upkeep. Crafting's Food slowdown is not used.

Finalized Game, GameState, Starbase and chain Clock are read from one bank. Resumable scans have fixed target slots; newer transactions wait for the next window. Same-slot deposits use block transaction order and instruction execution order. Reconciliation checks balance and accumulated Toolkit-local time. The bounded scan saves progress locally, with publication before anchor advancement.

Canonical snapshots and replenishments remain in the JSON `record` field of `starbase_upkeep_state`, tagged `model=toolkit-stop-v2`. Hourly evidence uses the same model tag. Legacy slowdown records are excluded. Recovery state remains in the application's user-data directory under `starbase-upkeep-v2`, with five 1,000-signature pages per refresh and 35-day retention. A first capture is a baseline, not historical backfill.

## Verification still needed

The public mainnet fixture validates SAGE2 layout, finalized slot, PHANTOM identities and the captured 77 units/second rate. It does **not** validate a historical on-chain shortage/refill interval. Compare a known shortage/replenishment period against the account clock and transaction evidence before applying downtime to chart capacity again. Automated replay and table tests are not substitutes for that validation.
