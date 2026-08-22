# B3.2B immutable LM/GM adapters

Pure foundation only; no production import, ledger mutation, RPC, network, or Influx operation.

## Trace and preservation

Current scanner sources retain transaction signature and block time. `marketplace-asset-flow.js` creates flow IDs from signature plus a filtered flow index/type, but does not retain source outer/inner instruction coordinates, slot, raw integer amount, or decimals. `local-market-trades.js` retains signature, mint, starbase and numeric economics but loses source instruction/fill coordinates and exact raw values. `local-market-scanner.js` retains signatures/order IDs and timestamps; production compatibility can rename `executionSignature` to `signature`. GM uses the same marketplace staging/publication paths. Cursor state exists separately and does not prove complete history.

Required adapter input therefore explicitly includes signature, slot string, block time, market/program, execution index or outer+inner+flow coordinates, mints, exact amounts/decimals, ownership/custody accounts, and fees. Missing coordinates are `Incomplete`; filtered-array position is forbidden.

## Identities

Execution: `market + programId + signature + executionIndex`, scoped by faction/profile and source system `marketplace-lm|gm`. Custody flow: `market + programId + signature + outerInstructionIndex + innerInstructionIndex + flowIndex`. LM/GM remain distinct. Custody flow is not a purchase lot.

## Exact values and fees

Raw asset/payment amounts, fees, lamports, slot and indexes are canonical strings; decimals are validated integers. Decimal quantity uses string arithmetic. Transaction fee and marketplace fee appear only on execution provenance. Custody flows carry no purchase payment or fees. Missing fee evidence is incomplete.

## Coverage

Coverage records scope, requested slot/time range, oldest/newest retained identities, cursor, completion, truncation, and failed pages. `identitySupported` is independent of `coverage`; a valid identity with truncation/missing pages remains `Incomplete`.

## Production gaps before integration

Existing LM/GM scanner output must retain source-native instruction/fill coordinates, slot, exact raw amounts/decimals, payment and fee raw values, and authoritative custody accounts. Existing filtered flow index cannot substitute for transaction coordinates. Historical cursor/page exhaustion and missing parsed transactions must feed the coverage descriptor.
