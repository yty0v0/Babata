## Context

The current integration has a working host adapter around Taric: checkpoint proposals are admitted, WorkRuns close with `checkpoint_id`, the outbox is reconciled, and an expired run is reclaimed by a replacement solver. Solver-side artifact capture now writes committed artifacts tagged with `attempt_id` and `work_run_id`, and checkpoint commits carry `artifact_refs` with SHA-256 hashes.

Two integration gaps remain. First, Taric authority has no `observation` or `evidence` record, so `observation_refs` and `evidence_refs` are empty and a checkpoint cannot be followed from a claim back to a verifiable record. Second, a transient `checkpoint.commit` failure after admission leaves the WorkRun open with no automatic repair; only a human re-approval or a crash/lease cycle closes it.

The constraint is that this change must not alter solver prompts, probing strategy, challenge lifecycle, scoring, or report generation. All work stays in the Taric host adapter.

## Goals / Non-Goals

**Goals:**

- Derive a real Taric `observation` from committed artifacts and bind its id into the admitted checkpoint as `observation_refs` / `evidence_refs`.
- Keep evidence binding best-effort: a checkpoint must still close when evidence cannot be recorded, with an explicit gap instead of a fabricated UUID.
- Add an idempotent repair pass for admitted-but-uncommitted checkpoints.
- Make the lease window deployable for faster crash recovery without changing solver behavior.
- Report evidence coverage and repair outcomes in the integration status.

**Non-Goals:**

- No change to solver prompts, tools, scope guard, memory, ideas, planner, or report submission.
- No L2 promotion or independent reviewer workflow.
- No resident Taric sidecar in this change; that is a separate performance change.
- No backfill of historical checkpoints that were committed before this capability.

## Decisions

### 1. Use Taric `observation` records, not a new evidence kind

Taric's `evidence_refs` accepts `observation`, `evidence`, `coverage`, and `note` records. Creating observations is enough to make checkpoints evidence-bearing, and it reuses the existing `capture.observation` / `proposal.submit` + `admission.evaluate` path.

Alternative: introduce a new evidence schema. Rejected because it requires Taric core changes and duplicates an existing record kind.

### 2. Ensure a target resource exists before creating an observation

An observation requires `resource_ref` of kind `resource`, `endpoint`, `service`, or `note`. The host will ensure one resource record per target asset, idempotent by asset hash, using a host-owned proposal. If the resource cannot be resolved, the host skips observation creation and records an evidence gap.

Alternative: use the engagement or scope as `resource_ref`. Rejected because Taric validates reference kinds and would reject the observation.

### 3. Record the observation before committing the checkpoint

Checkpoints are immutable, so evidence refs must exist before the commit. The host flow is:

1. Resolve or create the target resource.
2. Build a bounded observation statement from the checkpoint's completed steps and the artifact summaries.
3. Submit and admit the observation with an idempotency key derived from the checkpoint id and artifact hashes.
4. Commit the checkpoint with `artifact_refs` plus `observation_refs` / `evidence_refs`.
5. If steps 1-3 fail, commit the checkpoint with `artifact_refs` only and mark the evidence gap.

Alternative: commit first and patch later. Rejected because checkpoints are immutable.

### 4. Evidence binding is post-admission and non-blocking for WorkRun closure

Evidence recording can take seconds and may fail independently of admission. It must not prevent `checkpoint.commit`. The host records a gap on the WorkRun and exposes it in status; it does not retry forever.

Alternative: require evidence before admission. Rejected because it would strand WorkRuns on a non-authoritative record.

### 5. Repair pass is idempotent and bounded

On startup and on the existing 60-second heartbeat, the host scans local WorkRuns with status `active` or outbox entries in `approved` state whose WorkRun is not `checkpointed`. For each, it calls `closeWithAdmittedCheckpoint` with the stored payload. The commit is idempotent; already-closed runs are skipped. Batch size is capped to avoid blocking lease renewal.

Alternative: repair only on startup. Rejected because a transient failure during a live run would wait until the next process restart.

### 6. Lease is deployment-configurable, not hard-coded

The host reads `TCH_TARIC_LEASE_MS` with a default of 300000 ms and clamps it to 60000-900000 ms. Heartbeat renewal uses the existing schedule and renews before half the lease. A documented 120000 ms profile is available for crash drills. This changes only host timing, not solver behavior.

Alternative: add a new Taric operation for immediate release. Rejected for this change because it requires Taric core changes; the env override already enables a faster recovery profile.

## Risks / Trade-offs

- [Observation requires a resource record that may not exist] ? Ensure a host-owned resource per asset, idempotent by asset hash; if creation fails, skip observation and record an evidence gap.
- [Evidence recording adds 2-3 container calls per checkpoint] ? Run it after admission, bound retries, never block checkpoint commit.
- [Duplicate observations on retry] ? Derive the idempotency key from checkpoint id + sorted artifact hashes.
- [Sensitive content leaks into observation text] ? Use bounded summaries from checkpoint steps and artifact summaries; never include raw artifact bytes.
- [Repair loop competes with lease heartbeat] ? Renew leases first, cap the repair batch, and skip runs already closed.
- [Short lease increases Taric load] ? Clamp to >=60s and document 120s only for drills.
- [Historical checkpoints remain without evidence refs] ? Accept and report coverage; no backfill in this change.

## Migration Plan

1. Ship the evidence recorder and repair pass behind the existing `tch.taric.enabled` gate.
2. On startup, run one repair pass after lease reconciliation.
3. Keep `evidenceBinding` enabled by default; add a setting to disable it if observation creation is noisy.
4. Rollback: disable evidence binding; checkpoints still commit with `artifact_refs`. Disable Taric entirely with `tch.taric.enabled=false`.
5. Existing checkpoints stay readable; new checkpoints gain evidence refs.

## Open Questions

- Does the pinned Taric image accept `resource` and `observation` proposal kinds under the operator principal without adapter-specific fields? Confirm during implementation.
- Should the observation statement be built from checkpoint `completed_steps` or from artifact summaries? Start with completed steps plus a bounded artifact summary, then review.
- Do we need a backfill command for the handful of pre-change checkpoints? Defer until the forward path is stable.
