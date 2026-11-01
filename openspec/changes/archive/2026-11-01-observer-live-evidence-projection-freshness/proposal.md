## Why

A live DVWA run captured artifacts but Observer queried Taric before the report-triggered host checkpoint had bound those artifacts to real evidence records, so it saw an empty result and concluded `NO_CHANGE`. Separately, Taric had committed operations ahead of its read projection while the runtime health endpoint remained green, allowing stale reads to look authoritative. This change makes evidence visibility lifecycle-aware and projection freshness explicit so an empty result is not mistaken for proof of no evidence.

## What Changes

- Define a reliable Observer review point after report submission/host checkpoint processing, and require Observer to defer conclusions when evidence visibility is pending or degraded.
- Ensure read-board queries reconcile bounded pending Taric projection work before returning data, or return an explicit stale/degraded result with watermarks rather than a false empty success.
- Preserve the invariant that evidence references are real Taric record IDs; artifact IDs/hashes are not substituted for evidence IDs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `taric-read-board`: require freshness-aware reads and explicit stale projection outcomes.
- `taric-tool-result-capture`: make Observer review timing and evidence visibility consistent with captured artifacts and host checkpoint lifecycle.
- `taric-evidence-binding`: clarify that evidence is queryable only after a real observation is admitted/bound, and preserve no-fabrication behavior.

## Impact

Affects Observer extension lifecycle hooks, host report/checkpoint flow, Taric read-board and maintenance dispatch, and focused unit/integration tests. Runtime-wide integration-status freshness diagnostics are deferred until the host has a reliable engagement-scoped status source. No new dependency or change to Taric authority is intended.
