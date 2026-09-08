# Toolkit downtime validation (separate from charts)

**Current ownership: SLYA collects; Influx stores; MSA reads and analyses.**
See [Collector ownership](#collector-ownership-slya-current-migration) for the current
behavior. Earlier collection sections below document the superseded MSA implementation.

The upper Selection Uplift and UTC-Calendar Crew-State Utilization charts and calculation module are restored to **v0.6.285**. Axis navigation remains as in that version. Toolkit evidence and estimates do not modify chart inputs, productive work, claim lock, or configured capacity. The v0.6.286/287 supply-adjusted chart model is removed.

## Validation table

A compact, scrollable table in OP / Upgrading Analytics reports the selected faction's PHANTOM starbase, newest UTC date first, within the requested window and rolling 30-day boundary (not before August 14). Today contains elapsed time only.

- Covered: seconds supported by same-day account-clock windows or reconciled binary Toolkit intervals, with duplicate overlaps counted once.
- Toolkit Downtime: stopped seconds within covered time. No coverage displays `--`, not zero.
- Unknown: uncovered or conflicting seconds. Conflicting segments do not discard other segments in the diagnostic projection.
- Estimated Total: only for partial days with coverage, covered downtime / covered seconds × elapsed selected day seconds. This explicitly labelled same-day extrapolation may be unreliable with sparse coverage. It is not measured downtime and is never persisted as evidence. Without coverage there is no estimate; unknown time is still reported.
- Evidence: Account clock (optionally partial), Reconciled, Partial · estimate, or Not observed. Reconciled describes internal replay consistency, **not** independent real-world validation.

Table sync errors do not invalidate chart calculations. Analytics acquisition is reused; the independent UTC-boundary collector and shared clock storage are described below.

## Retained measurement path

Upgrading uses the Toolkit stop clock: full speed with upkeep, stopped while depleted. Zero reserve disables upkeep. Crafting's Food slowdown is not used.

Finalized Game, GameState, Starbase and chain Clock are read from one bank. Resumable scans have fixed target slots; newer transactions wait for the next window. Same-slot deposits use block transaction order and instruction execution order. Reconciliation checks balance and accumulated Toolkit-local time. The bounded scan saves progress locally, with publication before anchor advancement.

Canonical snapshots and replenishments remain in the JSON `record` field of `starbase_upkeep_state`, tagged `model=toolkit-stop-v2`. Hourly evidence uses the same model tag. Legacy slowdown records are excluded. Recovery state remains in the application's user-data directory under `starbase-upkeep-v2`, with five 1,000-signature pages per refresh and 35-day retention. A first capture is a baseline, not historical backfill.

## Verification still needed

The public mainnet fixture validates SAGE2 layout, finalized slot, PHANTOM identities and the captured 77 units/second rate. It does **not** validate a historical on-chain shortage/refill interval. Compare a known shortage/replenishment period against the account clock and transaction evidence before applying downtime to chart capacity again. Automated replay and table tests are not substitutes for that validation.

## Independent account-clock measurements (local follow-up to v0.6.289)

A fresh finalized snapshot is now captured before reading replay history. A separate
local `.json.observations` journal retains scoped snapshot pairs for 35 days. It
is saved independently of Influx reads/publication and transaction replay. No
additional RPC calls or timer are added: each existing Analytics acquisition uses
one snapshot for both paths. A failed capture retains previously measured windows;
a failed comparison skips only that pair and starts the next pair from the new
observation. Local write failures are visible and do not hide an in-memory result.

For compatible snapshots (same faction, PHANTOM address, tier, reserve and rate):

`stopped seconds = elapsed chain time - change in projected Toolkit-local time`

Projection uses the integer SDK stop clock, not crafting's slowdown. Negative or
above-elapsed clock differences are rejected. This assumes the upkeep configuration
did not change between captures; equal endpoint configuration cannot exclude an
intermediate configuration change. This is an account-clock measurement, not an
independently verified refill timeline.

Same-day windows wholly inside the selected period populate Covered and Toolkit
Downtime. Detailed replay outside those windows remains included; overlapping replay
is not counted twice. A window crossing midnight or a date filter is not prorated
into measured daily downtime. Its existence is disclosed, and the latest clock
window's full timestamps and stopped total are shown separately in the status.
The existing same-day Estimated Total remains explicitly extrapolated, not measured.

Errors now identify account capture, history read, transaction replay or history
publication with safe messages. HTTP write status codes are preserved (the former
letters-only filter hid them). Raw transport errors, URLs and credentials are not
sent to the renderer. The specific error on Viktor's desktop has not been observed
on this host: no desktop Toolkit journal was available here.

### Public-chain verification, 2026-09-07

The two committed public fixtures contain finalized bank snapshots at slots
445054254 and 445126813, 11:29:52–17:53:16 UTC (23,004 seconds). Both raw account
sets decode to their saved normalized values. Projecting each with the SDK's
`calculateCurrentResourceTimeStop` independently agrees with our clock comparison:

- MUD: 19,577 active seconds; **3,427 stopped seconds (57m 7s)**.
- ONI: 23,004 active seconds; **0 stopped seconds**.
- USTUR: 23,004 active seconds; **0 stopped seconds**.

This validates a nonzero real-account window total. Exact shortage/refill boundaries
and transaction-by-transaction reconciliation still need independent validation.
No live application or Influx data was changed to obtain these fixtures.

The charts and calculation module remain unchanged. Summary copy now explicitly
calls claim lock estimated (Toolkit pauses can inflate it), and the operational
summary is named Feasible-Neutral Capacity Range rather than implying an ATLAS result.


## Hourly and UTC-boundary collector

While MSA is running, a main-process collector captures all three PHANTOM
accounts every 30 seconds from 23:55 through 00:10 UTC, independently of the
selected tab/faction. Outside that window it captures once per UTC hour, on
the first timer tick in that hour (normally within 30 seconds, plus any ongoing
capture/upload delay). Midnight uses the same capture pass, not an extra hourly
pass. It also captures on startup and after a delayed timer
(suspension/resume or a wall-clock jump). Outside this window its timer checks
the clock between hourly captures and publication retries. Each faction fails independently;
subsequent boundary ticks retry. No transaction scan is triggered by this collector.
Clock observations are now published independently to Influx as described below. It uses the existing RPC provider and finalized bank
capture. Quit stops scheduling; an offline/closed app cannot collect observations.

Raw observations use the existing scoped, atomic 35-day journal. Analytics and
background read/modify/write operations are serialized so neither overwrites the
other's observations. Reopening the app retains the boundary evidence.

A timer firing at midnight is NOT treated as an exact midnight snapshot. The
finalized chain Clock determines the actual timestamp. For a crossing window,
midnight is reconstructed from the later account only when its Toolkit global
last-update timestamp is at or before that boundary. Thus no post-boundary upkeep
update has erased the relevant state. Each split is checked for physically valid
active/stopped time. Otherwise the crossing window stays unallocated. No downtime
is distributed proportionally or pre-boundary state projected into an unobserved
future. The existing unchanged-configuration assumption still applies.

Full-day account-clock totals are available when these windows cover the entire
UTC day; missing boundary evidence remains partial/unknown and any extrapolation
is still Estimated Total. This improves reliability, not a guarantee of daily
completeness during RPC failures, shutdown, or post-midnight account updates.
Charts remain unchanged. Boundary timing and recovery are tested with synthetic
observations; an overnight live run has not been performed for this local patch.


## Shared clock observations (local extension)

Run MSA on the mini-PC to collect; open/refresh Upgrading Analytics on the main
PC to read the shared observations. Both installations must use the same Influx
base URL, organization and **primary bucket** (not the Optimization bucket), with
read access on the viewer and write access on the collector. No journal copying
or installation-specific identifier is required: PHANTOM evidence is public,
scoped by faction and exact starbase account, not player profile.

Raw finalized observations are stored in `starbase_toolkit_clock_v1`, separately
from replay history and estimates. The `record` field contains only the canonical
account/clock fields. A content-based observation identity and chain timestamp
produce identical points on retry or duplicate capture; conflicting payloads for
one finalized slot are retained and excluded from adjacent comparisons rather
than selected by arrival order. The reader merges all local/shared observations
in slot order and recomputes non-overlapping clock windows with the existing UTC
boundary rules. Imported records are cached, not republished. Bad records and
foreign scope are ignored; incompatible adjacent clocks leave only a local gap.

The existing local observation journal remains independent. A second atomic
`.shared` journal retains raw observations, local publication ownership and
confirmed IDs for 35 days. Unpublished local observations are saved before HTTP
publication. Failed/ambiguous writes keep the same pending point bytes for retry.
Each pass publishes up to 512 observations in batches of 128, using the existing
Influx writer. Retries occur at boundary captures, startup/resume, Analytics
refresh and every five minutes while running; daytime retry ticks read saved
observations without RPC, replay scans or shared-history queries. Changing the
Influx destination uses a separate local scope; pending records are not redirected.
A closed application cannot upload; retention limits historical retry to 35 days.

Analytics performs a scoped 35-day shared-clock read on every acquisition even
when it already has a local replay checkpoint. Failed reads preserve cached/local
measurements, and failed uploads do not prevent local display. The table status
shows shared-read/upload failures and pending uploads without transport secrets.
The charts and their v285 calculations remain unchanged. Cross-installation and
failure recovery are tested with injected transports; no live Influx write or
real overnight deployment has been performed for this local patch.

## Collector ownership: SLYA (current migration)

MSA no longer schedules, captures, scans transaction history, or publishes Toolkit
observations. Analytics refresh reads `starbase_toolkit_clock_v1` and existing
`starbase_upkeep_state` records from its primary Influx bucket. It recomputes clock
windows and validates old replay records locally, retaining a disposable `.reader`
cache for network outages. Old `.observations`, `.shared`, and replay journals are
read for continuity but never drained, rewritten, or deleted. Unsynchronized data
on an old MSA installation remains available on that installation only.

SLYA now owns hourly and 23:55–00:10 UTC (30-second) captures, startup/resume
collection, and five-minute upload-only retries. A single SLYA collects all three
PHANTOM factions, independent of the selected faction or upgrade automation.
It uses its configured read RPC providers with finalized, consistent-slot snapshots,
not the periodic inventory `curAmount` feed. Raw observations use the unchanged
measurement, canonical fields, identity hash and chain timestamp. Multiple SLYAs
or old MSA collectors therefore do not multiply downtime.

Configure SLYA's normal Influx write destination to the same organization and
primary bucket that MSA reads. Nothing is automatically copied between settings.
SLYA's destination-scoped GM storage retains 35 days of observations and publication
confirmations, persisting before HTTP and retrying identical point bytes. Changing
destination isolates old queues; it does not send them to a new bucket. Token
rotation does not change queue identity. HTTP requests are bounded to 15 seconds;
batches remain at most 128 points and 512 per faction per pass. An outage beyond
35 days exceeds the retained retry history. Local storage failure prevents upload.

The old scheduler/replay implementation remains only as tested historical utilities,
not wired into MSA's production acquisition path. The prior sections describing
MSA background capture are historical. No chart calculations changed. Exact daily
coverage still requires sufficient boundary evidence; missed boundaries remain
unknown. This migration has automated fixture validation, not live overnight proof.

Toolkit RPC uses at most two configured read providers per request, with automatic
429 retries disabled and a 15-second deadline per HTTP response (including body).
It does not enter the automation proxy’s indefinitely retrying fallback loop.
