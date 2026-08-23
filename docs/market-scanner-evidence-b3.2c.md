# B3.2C scanner evidence preservation

The LM and GM scanner now emits a versioned `immutableEvidence` object beside unchanged legacy orders, trades, and asset flows. The same evidence and a versioned `coverage` descriptor are staged in safe marketplace checkpoints; neither is published or consumed by Break-even, inventory, UI, or Influx.

Execution identity uses the raw transaction signature plus the GM program outer instruction index. Inner token flows use the raw parent outer index, raw inner instruction index, and raw instruction-derived flow coordinate captured before filtering. No filtered ordinal is used as an execution identity. Transactions without an authoritative exchange instruction remain `Incomplete`.

Amounts are accepted only as canonical unsigned decimal strings (or safe unsigned integer inputs), with token decimals retained. Transaction fees remain lamports. Asset/payment/marketplace-fee mints, raw amounts, token accounts, owners, buyer, and seller are retained when authoritative; absent or ambiguous evidence leaves the object `Incomplete` without changing legacy rows.

Flows link only to the unique execution owning their parent outer instruction and matching an execution asset/payment mint plus authoritative party. Unrelated transfers remain unlinked. A flow is assigned at most once. Transaction fee belongs to transaction/execution evidence only; marketplace fee belongs to its execution only.

Coverage records requested start boundary, input/output cursors, requested/completed pages, discovered signatures, parsed/missing transactions, failed pages, caps, termination reason, and oldest/newest retained identities. `Complete` requires boundary reach or authoritative exhaustion with no failed page, missing transaction, RPC exhaustion, or cap.
