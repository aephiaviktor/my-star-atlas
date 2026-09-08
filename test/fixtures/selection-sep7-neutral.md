# Selection Uplift — 7 September 2026 regression

`selection-sep7-neutral.json` is a reduced local replay fixture from the shared
SLYA records inspected on 8 September 2026. It retains numeric completed-work
inputs, historical component prices, redemption rates and neutral-plan fields.
Wallet/profile addresses, transaction signatures, connection settings and
credentials are not included.

The production-reader regression pivots the already captured neutral records,
uses `snapshot_for_hour`, and checks rounded uplift totals independently against
the prior investigation: MUD 1359.63, ONI 461.41, USTUR 143.70 ATLAS. Only MUD's
19:00 UTC hour is estimated from the preceding observed plan. Tests do not query
RPC or Influx and do not rewrite source data.
