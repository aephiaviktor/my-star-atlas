# B3.3B exact inventory-cost ledger contract

This is a parallel, pure, production-unreferenced ledger. Legacy numeric ledger/checkpoint v1 state is `legacy-approximate`: it is never converted, imported, relabeled, or mixed with exact lots. Exact projection requires a validated exact opening checkpoint and exact immutable events; absent history returns `Incomplete` / `rebuild-required`.

Each lot records immutable lot and source-event IDs, provenance, faction/profile, location, asset, exact quantity, source-separated Base and Cargo components, currency, coverage/status, and opening-checkpoint/boundary bindings. Opening lots are uncosted and `Incomplete`.

FIFO is preserved as source time followed by stable lot identity. Acquisitions, replay-safe attributable costs, whole/split transfers, crafting, upgrading consumption, and sale/COGS operate in exact atoms. Splits use deterministic largest remainder. Every mutation checks quantity, Base, Cargo, and Total conservation; failures roll back atomically. Incomplete evidence propagates and has no cost-per-unit ratio.

Marketplace custody alone cannot create inventory. A purchase requires an eligible complete execution, proven related custody, exact asset/payment values, proven fee ownership, matching scope/currency, and charges each fee ID once across all flows.

Exact checkpoint persistence and shadow projection are intentionally deferred. Existing checkpoint v1 and all production call sites remain unchanged.

## Golden comparison

All twelve B3.0-R accounting scenarios retain their representable quantity, component-cost, Base/Cargo/Total, C/U, status, and ending-basis expectations. The exact fixtures use canonical atoms rather than converting the legacy fixture numbers. Expected differences occur only where the legacy ledger retains binary fractions (for example a one-atom cost split over three units): the exact ledger assigns indivisible residual atoms by largest remainder and stable identity instead of producing a floating fraction. Legacy output is deliberately unchanged.
