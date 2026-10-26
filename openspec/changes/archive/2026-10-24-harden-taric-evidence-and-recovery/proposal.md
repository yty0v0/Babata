## Why

Taric is now wired end to end: checkpoints are admitted, WorkRuns become `checkpointed`, projections reconcile, and an expired run is reclaimed by a replacement solver. Two gaps remain in the integration itself, not in the pentest logic:

1. `evidence_refs` and `observation_refs` are still empty. Checkpoints carry `artifact_refs` with hashes, so the raw bytes are verifiable, but Taric authority has no observation/evidence record tying a claim to that artifact. That keeps Taric a hashed work log rather than a verifiable evidence layer.
2. Recovery depends on a lease expiring (minutes) and on a human re-approving an admitted-but-uncommitted checkpoint. There is no host repair loop, so a transient `checkpoint.commit` failure can strand an otherwise admitted checkpoint.

## What Changes

- Add a host-side evidence recorder that, after a checkpoint is admitted, creates a Taric `observation` and `evidence` record from the captured artifacts and then references their ids in the checkpoint commit payload.
- Populate `observation_refs` / `evidence_refs` only with real Taric ids; never synthesize UUIDs. If evidence cannot be recorded, the checkpoint is still committed with `artifact_refs` and the gap is surfaced, not faked.
- Add a recovery repair pass: periodically scan for WorkRuns that are `active` or have an admitted-but-uncommitted checkpoint and retry the idempotent commit.
- Shorten the recovery window without changing solver behavior: make the WorkRun lease configurable per deployment and document a 120s profile for crash drills.
- Extend telemetry so the status endpoint reports evidence coverage (checkpoints with and without `evidence_refs`) and repair outcomes.
- **No change** to solver prompts, probing strategy, challenge lifecycle, report submission, memory/ideas, or planner decisions. This change touches only the Taric host adapter and its configuration.

## Capabilities

### New Capabilities

- `taric-evidence-binding`: derive Taric observation/evidence records from captured artifacts and bind them to admitted checkpoints, with explicit handling when evidence cannot be recorded.

### Modified Capabilities

- `taric-work-recovery`: add a host repair loop for admitted-but-uncommitted checkpoints and make the lease window deployment-configurable.
- `taric-observability`: report evidence coverage and repair outcomes in the integration status.

## Impact

- Affected code: `packages/core/src/challenge/taric-*` (admission follow-up, work manager, artifact store), `packages/core/src/index.ts` (DaemonManager wiring), and deployment settings under `tch.taric`.
- No changes to `packages/core/src/solver/**`, challenge scoring, coverage projection semantics, or report generation.
- Requires the Taric CLI operations `capture.observation` and `proposal.submit` under the host/operator principal; both already exist in the pinned image.
- Existing checkpoints without evidence refs stay readable; the new binding applies to checkpoints admitted after rollout.
