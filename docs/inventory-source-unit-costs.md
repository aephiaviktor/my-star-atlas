# Source unit costs and uncosted replay

Inventory Ledger Per Unit mode separates acquisition cohorts from cost components.
GM/LM divide purchase principal of known remaining units acquired from that market
by those units. GM ingredients in crafted Frameworks do not enter GM Framework
purchase price. Mining costs in crafted output divide by known remaining crafted
units (directly mined assets use their mined units); Crafting includes direct and
upstream conversion costs per remaining crafted output. The rows are scoped to
the existing faction/profile ledger and exact location/asset.

The ledger carries bounded cohorts through proportional weighted-pool depletion,
uncosted-first consumption, crafting and transfers. Source quantity is not physical
lot/FIFO identity. Transfers that use the existing estimated pool rate also carry
that pool's source mix. Marketplace wallet transfers preserve purchased source
quantities independently of zero-principal rewards or unknown game withdrawals.
Legacy imported cost breakdowns without acquisition quantities remain unattributed;
we never infer source quantities by dividing cost contributions by a market quote.

Total / Unit and Cargo / Unit retain their pooled denominators. Non-Per-Unit mode
retains additive contributions including purchased ingredients. Source unit values
therefore do not sum to Total / Unit. Hover values show known remaining quantities;
missing source evidence displays --, while observed zero displays numeric zero.

Replay first measures the positive difference between current inventory and the
chronological result. It then replays with that unexplained quantity uncosted
at the start of the replayable window, or immediately after the latest dated
inventory reconciliation for the pool. This is an explicit timing estimate, not a
claim that today's balance was historically observed. Dated observations are not
rewritten. A recovered overdraft can enable previously rejected consumption, so
recovery repeats from the immutable starting checkpoint until there is no remaining
endpoint shortfall. The recovery bound is the larger of 32 and the replay event count plus two
settlement passes, rather than a fixed 32: each pass can enable only one more
previously rejected upgrade. The final replay is checked before declaring failure. Only the converged replay's event
results, basis snapshots and checkpoint are returned. A nonconverging replay raises
an error before any checkpoint or basis publication, rather than saving a partial
result and adding replacement uncosted units afterward. This is not a rule that
freezes costed quantities: they still decrease when available uncosted stock really
is exhausted, or when authoritative historical inventory evidence requires it.
The pre-latest-day checkpoint includes inferred stock when appropriate;
latest-day stock is deterministically reconstructed on refresh. Final current
reconciliation is retained. Negative variances still deplete uncosted stock first.

Upgrading uses the exact consumed-lot basis when that history is fully costed. If
the consumed history is uncosted, Earnings values the installed quantity at the
current Inventory Ledger Total / Unit for the same starbase and asset. This is a
valuation fallback only: it does not reassign cohorts or reduce known costed stock.

Checkpoint schema 16 rebuilds schema 15 and older locally from available source history when
the patched app next loads a ledger. No data migration or Influx rewriting was run
while developing this patch. Unknown history cannot establish purchase provenance.
