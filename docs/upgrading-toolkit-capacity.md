# Supply-adjusted upgrading utilization

Introduced in My Star Atlas 0.6.286, calculation model `toolkit-stop-v2`.

- Upgrading uses the Toolkit stop clock: full speed while funded, zero when depleted. A zero reserve disables upkeep. Crafting's Food slowdown is not used.
- Completed productive work is not discounted a second time: required work remains amount × seconds per component. The stopped clock locates that work on the UTC timeline and determines actual work completion.
- The denominator is configured crew-hours integrated over the same effective clock as productive and claim-locked crew-hours. Claim delay statistics are wall-clock delay **after** work finished. Unknown Toolkit periods are estimated at full speed for display, never stored as observed evidence.
- Finalized Game, GameState, Starbase and chain Clock are read from one bank. Each resumable scan has a fixed target slot; newer transactions wait for the next window. Same-slot deposits use block transaction order and instruction execution order.
- A bounded scan saves each completed page locally. Publication precedes anchor advancement and can be retried idempotently. Reconciliation checks both balance and accumulated Toolkit-local time. Invalid windows remain unknown; configuration/reconciliation failures establish a new baseline for future recovery.
- Canonical snapshots and replenishments are retained in the JSON `record` field of `starbase_upkeep_state`, tagged `model=toolkit-stop-v2`. The full scoped record, not an incomplete subset of its fields, is restored. Hourly rows use the same model tag. Legacy slowdown rows are never interpreted as stop-clock evidence.
- Local recovery state is under the application's user-data directory, `starbase-upkeep-v2`. Catch-up is limited to five 1,000-signature pages per backend refresh. Data is retained for 35 days. No new timer or six-hour capture cache is used.
- A first snapshot is only a baseline, not a 30-day backfill. Dates without a prior reliable anchor now use labelled estimates. Missing configured hours use the nearest observation (including explicit zero), or peak simultaneous job crew as a lower bound when no configuration exists; days with no effective capacity have no percentage. Unclassified capacity remains unknown, including unrepresented in-flight jobs.
- Rates with fractional whole-unit depletion are currently rejected, not approximated with the SDK's BN truncation. The public PHANTOM configuration captured on September 7 uses 7,700 hundredths (77 units/second) for all three factions.

## Verification

Automated checks cover SDK stop-clock arithmetic, depletion/refill replay, missing deposits with equal empty balances, snapshot/scan boundaries, pagination restart, publication failure, scoped persistence/Influx restoration, exact instruction account matching, overlapping evidence, effective-time job completion, and estimated coverage.

`test/fixtures/phantom-upkeep-mainnet-20260907.json` is a read-only public mainnet capture validating the SAGE2 account layout, finalized Clock slot, faction addresses and current configuration. It **does not** validate a historical on-chain shortage/refill interval. That end-to-end historical validation remains outstanding; do not represent the fixture or synthetic replay tests as that proof.

## Best-effort chart estimates

The presentation model is now `upgrading-selection-utilization-estimated-v3`; persisted RPC evidence remains `toolkit-stop-v2`. Missing Toolkit intervals assume full supply, while known empty intervals still reduce capacity. Missing neutral allocation hours borrow the nearest observed mix, never an invented mix when none exists. Missing prices or redemption values still need a usable economic basis.

Completed component work is preserved. Inconsistent job timing distributes required work over the available active interval (or the wall interval if none is supported), with an explicit estimate label. If measured work exceeds reconstructed capacity, displayed capacity is raised to the observed work/claim-lock lower bound rather than hiding the day. These are estimates, not verified utilization. Zero effective capacity with no productive work still has no defined percentage.

Estimates are computed locally for charts only, not written into canonical upkeep history. Both charts show the assumptions; exact evidence remains distinguishable through `estimated`, `display_available`, and coverage flags.
