# Break-even accounting contract — B3.0-R reconciliation

Baseline: My Star Atlas `0.6.163`, commit `cc5bb698d216394a0b2cf81a61f83e3766716a3b`.
This packet freezes expectations only. It does not authorize or implement production changes.

## Contract

- `Base Cost/Unit = Scanning + Mining + LM Purchases + GM Purchases + Crafting`
- `Cargo Cost/Unit = attributable Fuel + Rental + Transaction costs for transporting the asset`
- `Total Cost/Unit = Base Cost/Unit + Cargo Cost/Unit`
- Every attributable cost is counted exactly once.
- The denominator is delivered asset amount, never cargo volume.
- Missing history is `Incomplete`/unavailable, never fabricated zero.
- Base and Total Cost/Unit remain Break-even fields, not Cargo Allocation fields.
- GM basis requires proven wallet-to-faction/starbase destination lineage.
- Current rental rates are not historical rental evidence.
- Quantity, per-component cost provenance, uncosted quantity, and availability survive acquire, transfer, craft, and consume operations.

## Current source-to-ledger matrix

| Source | Adapter exists | Production snapshot supplies it | Current status |
|---|---:|---:|---|
| Opening inventory | yes: `buildOpeningInventoryEvents` | yes, only when no checkpoint | provisional; query is `range(start: -38d, stop: -31d)` and therefore depends on history outside the 30-day event window |
| Scanning | yes: `buildScanningAcquisitionEvents` | yes: `rows` | wired; missing cost becomes explicit uncosted quantity |
| Mining | yes: `buildMiningAcquisitionEvents` | yes: `mining` | wired; aggregate row identity/cost allocation is not immutable source-event evidence |
| Crafting | yes: `buildCraftingEvents` | yes: `ledgerCraftingRows` | wired; requires ingredients plus fee and TX cost |
| LM purchases | yes: `buildLocalMarketLedgerEvents` | no | gap: `localMarketResult = { trades: [], error: '' }` |
| GM purchases | same adapter, initially at `wallet:<wallet>` | no purchase lots | gap: no supplied GM trade; faction basis requires proven downstream asset-flow lineage |
| Cargo transfers/costs | yes: `buildCargoTransferEvents` | no | gap: production passes `cargoRows: []` |
| Upgrading consumption | yes: `buildUpgradingConsumptionEvents` | yes: `upgradingRows.ledgerEvents` | wired; consumed basis is checkpointed for historical rows |
| Sales/outgoing inventory | consume events can represent LM/GM sales | no current trade feed | gap: no production COGS/revenue reconciliation feed |
| Marketplace asset-flow events | accepted directly as ledger events | yes: `fetchMarketplaceAssetFlowsFromInflux` | provisional; flows can move existing lots but cannot create the missing GM purchase lot; attribution is only valid when the complete custody chain is proven |

## Confirmed risks and gaps

1. `localMarketResult` is hard-coded empty in the Break-even snapshot.
2. `cargoRows` is passed as an empty array.
3. Opening inventory depends on the `-38d..-31d` Influx interval, outside the rolling 30-day event window. If absent, the baseline cannot be reconstructed.
4. Replay identity hashes the complete normalized event object. Mutable aggregates (quantity, cost, inferred location and other fields) therefore change identity and can be reapplied instead of superseded.
5. Precision-sensitive quantities, proportional allocations, costs, per-unit division, epsilon checks, and JSON snapshots use JavaScript `Number`.
6. Cargo rental currently comes from the live rental contract/rate path. There is no immutable allocation-time historical rental event for Break-even; current rates must not be backfilled as history.
7. GM acquisition is initially wallet-scoped. It cannot enter faction/starbase basis until an exact asset amount is linked through the complete wallet/handler/CSS custody path. A split requires conserved quantities and distinct proven destinations.

## Golden fixtures

Executable definitions are in `test/breakeven-accounting-golden.test.js`.

| # | Fixture | Expected contract result |
|---:|---|---|
| 1 | Scanned SDU | 100 SDU; scanning 5; base/total 0.05; complete; ending basis 5 |
| 2 | Multi-resource Mining | Carbon 60/6 and Iron 40/4; shared pool reconciles to 10 exactly once; base 0.1 each |
| 3 | LM buy | 10 Food; LM 12.3 including price+marketplace+TX fees; base/total 1.23 |
| 4 | Pending GM | 20 Fuel/8 remains at wallet; no faction lot until lineage exists |
| 5 | Whole/split GM attribution | 30 Fuel/12 splits to MUD 10/4 and UST 20/8; quantity and basis conserved |
| 6 | Crafting | 10 Carbon basis 5 + conversion 3 becomes 2 Framework; base 4 |
| 7 | Cargo | 40 Carbon carries mining 8 and adds logistics 4; base 0.2, cargo 0.1, total 0.3 |
| 8 | Sale/COGS | sell 4 of 10 Food/20; COGS 8; ending 6/12 at base 2 |
| 9 | Missing opening history | 7 Biomass uncosted; `Incomplete`; all per-unit contract values unavailable, not zero |
| 10 | Reconciliation | split transfer and consumption conserve quantity 10 and mining basis 5 |
| 11 | Tiny vs zero | `0.00000001` per unit remains nonzero; genuine zero remains exact zero |
| 12 | Replay | checkpointed duplicate applies zero additional quantity/cost |

Each executable assertion covers quantity, source costs, cargo cost, Base/Cargo/Total Cost per unit, coverage status, and ending inventory basis where applicable.

## Marketplace dependency

Break-even must not ingest GM basis merely because a purchase or custody transfer exists independently. The purchase creates a wallet lot. Publication/decoder identities must then prove each transfer in the custody chain, conserve asset quantity, and identify the destination faction/starbase. Only then may the corresponding weighted GM lot enter that destination. Pending, ambiguous, partial, duplicated, or mismatched paths remain wallet-scoped/unallocated and must be visible as incomplete reconciliation work.

## Smallest safe production packet

Implement a durable opening-inventory checkpoint only: one immutable, versioned baseline per profile/faction with source timestamp, location/asset quantities, provenance, atomic write, validation, and explicit unavailable status. Do not add LM/GM/Cargo feeds in the same packet. This removes dependence on expiring Influx history before changing replay identity or arithmetic.

Recommended order after review:

1. durable opening-inventory checkpoint;
2. immutable source event identities and supersession semantics;
3. fixed-point accounting boundary;
4. verified Marketplace asset attribution;
5. LM/GM ledger lots;
6. Cargo transfers and immutable historical rental basis;
7. sales, COGS, and full quantity/basis reconciliation.
