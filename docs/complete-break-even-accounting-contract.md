# Complete Break-even Accounting Contract

Version 1 — frozen for My Star Atlas 0.6.171

## Scope and equation

For one canonical `(faction, player profile, UTC period, asset)` identity, events are ordered by authoritative timestamp and immutable event ID. The auditable quantity equation is:

`opening + acquisitions + production/transfers in - consumption/transfers out - sales = expected closing`

Transfers between locations inside the same profile conserve the profile-wide quantity. Location rows show both sides; profile/asset totals net internal transfers to zero. Expected closing is compared with authoritative `slya.starbase.curAmount` at the period end.

## Exactness and basis

- Quantities and ATLAS values use canonical `{ atoms, decimals, unit }` values and fixed-point arithmetic.
- Weighted lot basis is preserved through deterministic whole/split lot movement and consumption.
- Cost sources are scanning, mining/rental, crafting, LM, GM, and Cargo fuel/rental/transaction allocation.
- Crafting transfers weighted ingredient and Cargo basis and adds only direct crafting and transaction costs.
- Sales consume lots chronologically. COGS is the consumed known basis; net proceeds are exact gross proceeds less attributable fees; realized profit is available only for the costed portion and carries an explicit coverage ratio.
- Unknown opening or historical basis remains `uncosted`; it is never treated as zero.

## Evidence states

Every source quantity is classified exactly once as `applied`, `pending`, `unallocated`, `uncosted`, `rejected`, or `quarantined`. Identical immutable event replay is idempotent. A changed payload for the same immutable event ID is quarantined. No source event or quantity may be consumed twice.

## User-visible result

Rows expose opening quantity/basis; LM, GM, scanning, mining/rental, crafting, and Cargo acquisitions; transfer/consumption movement; sales, net proceeds, COGS, realized profit; remaining quantity/basis and average cost; authoritative actual closing; reconciliation difference/status; cost-basis coverage; pending, unallocated, uncosted, rejected, and quarantined quantities; freshness and source details.

Missing evidence is `unavailable`, `pending`, `uncosted`, or `quarantined`, never numeric zero. A stale last-known-good result remains displayable while bounded refresh is in progress or temporarily fails.

## Persistence and performance

Opening inventory binds to the existing restart-safe exact checkpoint boundary. Existing Influx, Marketplace, Cargo C1, cache, IPC, and durable-state paths are reused. This outcome adds no recurring RPC loop, polling timer, Marketplace cadence, production write, or manual-refresh dependency.
