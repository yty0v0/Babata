## Why

Taric is already wired into the host, but it currently behaves as an optional model tool alongside `bash`, `memory`, and `idea`. In the latest DVWA high-scope run, Taric was called 4 times versus 93 bash calls, and the evidence coverage ratio was 0.1, so the model can test, remember, report, and finish without Taric becoming the authoritative persistent state.

The target defined in the desktop integration plan is different: Taric should be the only shared state blackboard for planner, executor, and observer. Host code must own writes, admission, evidence binding, checkpoint, and recovery, while model agents only read bounded context packs and submit proposals.

## What Changes

- Make Taric context loading mandatory at solver startup and checkpoint submission mandatory before solver completion.
- Route model state persistence through Taric proposals instead of direct `memory_*` and `idea_*` writes.
- Capture executor tool results automatically into Taric artifacts, observations, and evidence refs at host-controlled boundaries.
- Require evidence-backed checkpoints and admission before a challenge report can be accepted.
- Treat WorkItems as the lifecycle unit that executors claim, checkpoint, and can be reclaimed after crash or lease expiry.
- Expose blackboard coverage, evidence binding, admission, and recovery state in Taric observability.
- Keep Taric as state and evidence authority only; it does not execute tools, schedule agents, or replace challenge scoring.

## Capabilities

### New Capabilities

- `taric-authoritative-lifecycle`: Taric owns solver start context, work claiming, checkpoint boundaries, and end-of-run state closure.
- `taric-tool-result-capture`: Host captures bounded tool results into Taric artifacts and observations, then binds evidence refs to checkpoints.
- `taric-report-gate`: Challenge report submission must pass a Taric checkpoint/evidence/admission gate before it is accepted.

### Modified Capabilities

- `taric-proposal-governance`: Model proposals become mandatory lifecycle inputs, host-derived authority fields remain non-overridable, and admission gates evidence-bearing checkpoints.
- `taric-work-recovery`: WorkItem lifecycle and recovery are driven from the authoritative blackboard, including claim, lease, fencing, and resume from the latest admitted checkpoint.
- `taric-observability`: Report blackboard state coverage, automatic capture outcomes, and report-gate failures.

## Impact

- Affected code: `packages/core/src/challenge/taric-*`, `packages/core/src/solver/session.ts`, challenge observer tools, report submission tool, and prompt construction under `packages/core/src/config/prompts`.
- Existing `memory_*` and `idea_*` model tools become read-only projections or host-maintained cache when Taric is enabled.
- Existing challenge JSON state remains for UI compatibility but is no longer the authoritative executor memory.
- Taric remains optional as a deployment feature, but when enabled it is no longer optional for the solver lifecycle.
