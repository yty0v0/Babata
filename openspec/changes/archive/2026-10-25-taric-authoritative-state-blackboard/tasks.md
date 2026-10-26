## 1. Baseline and contract

- [x] 1.1 Audit current Taric host components and list which are already wired into solver lifecycle
- [x] 1.2 Document current model-facing Taric tools and their conditional registration rules
- [x] 1.3 Capture the current DVWA high-scope run metrics: Taric calls, bash calls, evidence coverage, memory/idea errors
- [x] 1.4 Define the authoritative blackboard contract for planner, executor, observer, and host roles
- [x] 1.5 Add a feature flag for the new lifecycle while keeping `tch.taric.enabled` as the outer switch

## 2. Read-only memory and idea projections

- [x] 2.1 Identify every model-facing `memory_*` and `idea_*` tool call path used by solvers
- [x] 2.2 Make model memory/idea writes read-only or proposal-routed when Taric binding is active
- [x] 2.3 Preserve read-only memory/idea views for UI and solver startup summaries
- [x] 2.4 Add a host-only projection builder that derives memory/idea records from Taric observations
- [x] 2.5 Ensure legacy non-Taric challenges retain current writable memory/idea behavior

## 3. Mandatory Taric context injection

- [x] 3.1 Add a host helper to load the latest Taric context pack for a solver role
- [x] 3.2 Inject the context pack into solver system prompt when Taric binding is active
- [x] 3.3 Include admitted checkpoints, WorkItems, coverage gaps, and role-specific constraints in the pack
- [x] 3.4 Keep raw artifact bytes and hidden reasoning out of the injected context
- [x] 3.5 Add tests proving the context is injected when binding is active and absent when disabled

## 4. WorkItem lifecycle

- [x] 4.1 Create or claim a WorkItem for each executor assignment at solver start
- [x] 4.2 Record WorkItem id and asset hash in the solver startup snapshot
- [x] 4.3 Enforce that execution work is associated with a WorkItem when Taric is enabled
- [x] 4.4 Add a host method to close the WorkItem after checkpoint and report gate pass
- [x] 4.5 Add failure handling when WorkItem claim is rejected

## 5. Mandatory checkpoint boundaries

- [x] 5.1 Enforce startup checkpoint or work claim checkpoint
- [x] 5.2 Enqueue checkpoint after report-worthy findings
- [x] 5.3 Enforce pre-completion checkpoint before solver exit
- [x] 5.4 Allow explicit evidence-gap checkpoint with host-recorded reason
- [x] 5.5 Reject normal solver completion when no current checkpoint exists

## 6. Automatic tool-result capture

- [x] 6.1 Add a host-side tool-result capture hook for Taric-enabled sessions
- [x] 6.2 Create a bounded observation from tool result text and metadata
- [x] 6.3 Store original tool bytes in the Taric artifact spool when above inline threshold
- [x] 6.4 Derive stable artifact hashes and evidence refs from captured bytes
- [x] 6.5 Ignore model-supplied evidence refs in checkpoint admission
- [x] 6.6 Redact credentials, cookies, and authorization headers before capture
- [x] 6.7 Capture both success and negative evidence with bounded context

## 7. Report gate

- [x] 7.1 Modify `challenge_submit_report` to check Taric state when binding is active
- [x] 7.2 Require a current checkpoint for the submitted asset
- [x] 7.3 Require evidence refs or an explicit evidence gap on the checkpoint
- [x] 7.4 Return a specific report-gate error when lifecycle requirements fail
- [x] 7.5 Record report-gate failures in Taric observability
- [x] 7.6 Keep legacy report behavior unchanged when Taric is disabled

## 8. Proposal governance and admission

- [x] 8.1 Normalize WorkItem, observation, claim, and checkpoint proposals through the existing outbox
- [x] 8.2 Preserve host-only authority fields and reject model overrides
- [x] 8.3 Add admission rules for evidence-bearing checkpoints
- [x] 8.4 Add admission rule for report-worthy finding checkpoints
- [x] 8.5 Ensure L0 proposals remain isolated from report and UI until admitted

## 9. Work recovery

- [x] 9.1 Treat WorkItem as the recovery unit after solver crash or lease expiry
- [x] 9.2 Resume replacement solver from the latest admitted checkpoint
- [x] 9.3 Requeue WorkItems without a checkpoint instead of fabricating state
- [x] 9.4 Surface stale-write and recovery outcomes in Taric status

## 10. Observability

- [x] 10.1 Expose active WorkItems and checkpoint coverage
- [x] 10.2 Expose automatic capture counters: captured, skipped, failed
- [x] 10.3 Expose evidence coverage and report-gate failures
- [x] 10.4 Expose lifecycle gaps and recovery status in `/api/taric/status`
- [x] 10.5 Add UI-friendly fields without breaking existing status consumers

## 11. Tests

- [x] 11.1 Unit-test mandatory context injection for active and inactive Taric bindings
- [x] 11.2 Unit-test WorkItem claim failure closes solver startup
- [x] 11.3 Unit-test checkpoint boundary enforcement at finding and completion
- [x] 11.4 Unit-test read-only memory/idea behavior under Taric
- [x] 11.5 Unit-test tool-result capture and artifact hashing
- [x] 11.6 Unit-test redaction of sensitive headers and credentials
- [x] 11.7 Unit-test report gate success, missing checkpoint, and evidence-gap cases
- [x] 11.8 Unit-test recovery resume from checkpoint and requeue without checkpoint
- [x] 11.9 Unit-test observability counters and status shape
- [x] 11.10 Add an end-to-end DVWA scenario that completes only through Taric blackboard flow

## 12. Verification

- [x] 12.1 Run `node node_modules/typescript/bin/tsc --noEmit -p packages/core`
- [x] 12.2 Run `node node_modules/typescript/bin/tsc --noEmit -p packages/ui-web`
- [x] 12.3 Run import and generator scripts
- [x] 12.4 Run available Bun tests for changed packages
- [x] 12.5 Run `openspec validate taric-authoritative-state-blackboard`
- [x] 12.6 Confirm the DVWA high-scope run shows non-zero checkpoint and evidence coverage
- [x] 12.7 Verify legacy Taric-disabled challenge path remains unchanged

## 13. Remove model-facing Taric tools and host-automate checkpoint

- [x] 13.1 Remove `taric_board_query` and `taric_proposal_submit` from solver session custom tools
- [x] 13.2 Keep Taric host bridge handlers for internal compatibility without registering model tools
- [x] 13.3 Replace solver prompt guidance that asks the model to call Taric tools with host-managed lifecycle text
- [x] 13.4 Add host checkpoint generation from captured artifacts before report gate evaluation
- [x] 13.5 Bind evidence to the host-generated checkpoint or record an explicit evidence gap
- [x] 13.6 Preserve `taric_proposal_submit` governance path for any non-solver/internal callers if required
- [x] 13.7 Update tests to assert Taric tools are absent from model sessions
- [x] 13.8 Add an end-to-end DVWA smoke run that completes without model Taric tool calls
- [x] 13.9 Run core typecheck, available Bun tests, and `openspec validate`

## 14. Close legacy persistence divergence while Taric is active

- [x] 14.1 Use Taric memory/idea projections for solver startup seed when Taric is active
- [x] 14.2 Use Taric projections for solver task memory/idea summaries when Taric is active
- [x] 14.3 Return Taric projections from challenge details API when Taric is active
- [x] 14.4 Reject UI memory/idea writes when Taric is the authoritative blackboard
- [x] 14.5 Keep legacy non-Taric challenge behavior unchanged
- [x] 14.6 Run core and UI typecheck, available Bun tests, and `openspec validate`
