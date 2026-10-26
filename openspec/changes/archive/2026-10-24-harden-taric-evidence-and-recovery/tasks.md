## 1. Evidence binding foundations

- [x] 1.1 Add a Taric evidence dispatcher for host-principal `proposal.submit` and `admission.evaluate`, reusing the existing docker work dispatcher pattern
- [x] 1.2 Add `taric-evidence-recorder.ts` that resolves or creates a target `resource` record per asset hash with a stable idempotency key
- [x] 1.3 Build a bounded observation statement from checkpoint `completed_steps` and artifact summaries, never including raw artifact bytes
- [x] 1.4 Derive the observation idempotency key from the checkpoint id plus sorted artifact hashes so retries reuse the same record
- [x] 1.5 Return a typed result that distinguishes `bound`, `skipped` (no artifacts), and `gap` (recording failed)

## 2. Checkpoint closure with evidence

- [x] 2.1 Extend `TaricCheckpointPayload` to accept `observation_refs` and validate they are host-derived UUIDs
- [x] 2.2 Wire the recorder into the admission `onAdmitted` path before `closeWithAdmittedCheckpoint`
- [x] 2.3 Commit the checkpoint with `artifact_refs` plus `observation_refs` / `evidence_refs` when binding succeeds
- [x] 2.4 On binding failure, commit with `artifact_refs` only and record an evidence gap on the WorkRun record
- [x] 2.5 Ensure model-supplied `evidence_refs` / `observation_refs` are ignored by the proposal normalizer

## 3. Recovery repair pass

- [x] 3.1 Add `TaricWorkManager.listUncommittedAdmitted()` returning WorkRuns whose outbox entry is approved but whose record is not `checkpointed`
- [x] 3.2 Add a bounded repair method that retries `closeWithAdmittedCheckpoint` and records the last error per run
- [x] 3.3 Run the repair pass on startup after lease reconciliation and on the 60-second heartbeat, after lease renewal and auto-admission
- [x] 3.4 Cap the repair batch and skip runs already `checkpointed`

## 4. Configurable lease

- [x] 4.1 Read `TCH_TARIC_LEASE_MS` with a 300000 ms default and clamp to 60000-900000 ms
- [x] 4.2 Log the effective lease value at startup
- [x] 4.3 Document the 120000 ms crash-drill profile in `DEPLOY-LOCAL.md`

## 5. Observability

- [x] 5.1 Report evidence coverage: recent committed checkpoints with and without `evidence_refs`
- [x] 5.2 Report repair counts (`repaired`, `awaitingRepair`) and the last repair error
- [x] 5.3 Extend `/api/taric/status` and the status type without breaking existing fields

## 6. Tests

- [x] 6.1 Unit-test the recorder: bound, skipped, gap, and idempotent retry
- [x] 6.2 Unit-test that model-supplied evidence refs are stripped
- [x] 6.3 Unit-test the repair pass: repairs once, skips closed runs, records repeated failures
- [x] 6.4 Unit-test lease clamping and default
- [x] 6.5 Extend observability tests for evidence coverage and repair counters

## 7. Verification

- [x] 7.1 `tsc --noEmit -p packages/core`
- [x] 7.2 `bun test` on Windows and in the Linux Bun container
- [x] 7.3 End-to-end DVWA checkpoint: confirm `evidence_refs` non-empty and WorkRun `checkpointed`
- [x] 7.4 Crash drill with the short-lease profile: confirm repair/reclaim closes the WorkRun
- [x] 7.5 `openspec validate --specs` still passes for all archived specs
