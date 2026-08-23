# B3.3A exact arithmetic contract

Values are canonical non-negative integer atom strings with decimals (0–36) and explicit unit/mint/currency identity. Inputs are bounded to 128 coefficient digits; BigInt intermediates to 256 digits. Bounds fail explicitly as `overflow` or `unsupported-precision`. Direction is external semantics.

Compatible values align scales exactly. Addition, comparison, summation and checked subtraction enforce units; subtraction cannot go below zero. Multiplication requires an explicit output unit. Cost basis requires exact `Total = Base + Cargo`; missing components are `Incomplete`.

Cost per unit is an exact numerator/denominator ratio retaining both scales. Zero denominator is unavailable. Decimal rendering occurs only on request at scale 18, once, using round-half-even and canonical plain decimal notation.

Shared costs use deterministic largest remainder over exact aligned quantity weights. Currency atoms are conserved exactly; ties use stable identity; zero total weight is unavailable.

The module is pure and foundation-only: no production import, ledger migration, scanner/RPC/Influx path, or UI integration.
