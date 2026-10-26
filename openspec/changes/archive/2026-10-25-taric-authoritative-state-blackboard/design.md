## Context

Current Taric implementation already has a host-side authority: HTTP sidecar, binding registry, artifact store, proposal outbox, admission manager, evidence recorder, work manager, maintenance loop, and observability. Model-facing tools are limited to `taric_board_query` and `taric_proposal_submit`.

At the same time, solver sessions still expose writable `memory_*` and `idea_*` tools, and the planner/executor lifecycle is mostly driven by challenge JSON state. This creates two competing memories:

1. Challenge memory/idea files maintained by the model.
2. Taric authority state maintained by host code.

The model can complete a challenge without consuming or checkpointing Taric. Observed evidence coverage is currently low, and memory/idea tools generate not-found errors when the model invents or reuses stale IDs.

## Goals / Non-Goals

**Goals:**

- When Taric is enabled, every solver session SHALL start from an injected Taric context pack.
- Every solver session SHALL submit a checkpoint before it may finish.
- Tool results SHALL be captured into Taric artifacts and observations by the host, not by model choice.
- Challenge report submission SHALL require a valid Taric checkpoint and evidence admission when Taric is enabled.
- Memory/idea model writes SHALL be removed or made read-only projections when Taric is enabled.
- WorkItem claim, lease, checkpoint, and recovery SHALL become the authoritative executor lifecycle.

**Non-Goals:**

- Taric will not execute pentest tools or schedule agents.
- Taric will not replace challenge scoring, report formatting, or planner concurrency limits.
- This change does not remove the ability to run without Taric; it makes Taric authoritative only when enabled.
- This change does not implement cloud-scale distributed Taric; it remains a single-host SQLite authority.

## Decisions

### Decision 1: Taric context is injected by host, not requested by model

At solver construction, when Taric binding is active, host code reads the latest context pack for the role and appends it to the system prompt as a mandatory block. The model cannot skip the read.

Rationale: Making context loading a prompt instruction still allows the model to ignore it. Host injection removes optionality.

Alternative: Keep `taric_board_query` only and strengthen prompt wording. This does not close the bypass.

### Decision 2: Model state writes become Taric proposals

When Taric is enabled, the model no longer writes `memory_*` or `idea_*`. Host code captures observations from tool results and admits them into Taric. UI memory/idea views become projections of Taric-derived state.

Rationale: A single authority prevents duplicate IDs, hallucinated writes, and divergent memory.

Alternative: Keep memory/idea tools and reconcile periodically. This remains a second source of truth and reintroduces race conditions.

### Decision 3: Host captures tool results at a bounded boundary

Not every command output is stored verbatim. Host captures:

- A bounded text summary.
- Original bytes in the Taric artifact spool when above a size threshold.
- Observation metadata such as role, asset, tool name, result type, and timestamps.
- Evidence refs derived from stable content hashes.

Rationale: This gives Taric verifiable evidence without polluting the model context with raw artifacts.

Alternative: Store all tool output inline in context. This defeats context budgeting and leaks raw bytes into the model.

### Decision 4: Checkpoint is mandatory but not synchronous for every tool call

Checkpoint boundaries are:

- Executor startup.
- After each report-worthy finding.
- Before executor completion.
- Before a host-reclaimed or timed-out solver is closed.

Host code enforces boundaries. The model proposes content; the host admits and commits it.

Rationale: Mandatory checkpoints give recovery points without forcing a database transaction after every trivial command.

Alternative: Checkpoint after every tool result. This is safer but adds write contention and overhead.

### Decision 5: Report submission goes through a Taric gate

When Taric is enabled, `challenge_submit_report` validates:

- The asset has a checkpoint in the current work run.
- The checkpoint references admitted evidence or an explicit evidence gap.
- The model is not supplying `evidence_refs` or `observation_refs` directly.

Rationale: The report becomes a projection of admitted Taric state instead of an independent model artifact.

Alternative: Keep report submission independent. This leaves the current bypass and low evidence coverage.

### Decision 6: Existing Taric components are reused

Reuse `taric-read-board`, `taric-proposal-outbox`, `taric-admission-manager`, `taric-artifact-store`, `taric-evidence-recorder`, `taric-work-manager`, and `taric-observability`. Add lifecycle orchestration around them rather than creating a parallel authority.

Rationale: The host primitives already exist; the missing piece is lifecycle enforcement and tool-result wiring.

Alternative: Build a new Taric integration layer from scratch. This duplicates tested code and increases risk.

## Risks / Trade-offs

- [Model loses direct memory/idea tools] -> Provide read-only projections and clear Taric proposal guidance.
- [More checkpoint writes may increase latency] -> Use bounded checkpoint boundaries and asynchronous host commit.
- [Evidence capture may capture credentials or cookies] -> Redact sensitive fields, cap inline bytes, and route raw content to spool with access control.
- [Report gate may block valid reports] -> Allow explicit evidence-gap status and make gate diagnostics visible in Taric status.
- [Existing challenges without Taric binding] -> Keep legacy path unchanged when Taric is disabled or binding absent.
- [Migration complexity] -> Roll out behind the existing `tch.taric.enabled` flag and validate with the DVWA smoke challenge.

## Migration Plan

1. Add lifecycle enforcement behind the existing Taric enabled flag.
2. Make memory/idea tools read-only projections only when Taric binding is active.
3. Enable automatic tool-result capture for challenge sessions.
4. Enforce checkpoint before report submission.
5. Add observability for blackboard coverage and gate failures.
6. Roll back by disabling `tch.taric.enabled`; legacy challenge JSON behavior remains available.

## Open Questions

- Should checkpoint frequency be configurable per challenge difficulty?
- Should observer corrections be host-enforced before the next planner round?
- Should memory/idea UI remain writable for operators, or become fully read-only when Taric is active?
- What is the exact redaction policy for captured HTTP headers and cookies?
