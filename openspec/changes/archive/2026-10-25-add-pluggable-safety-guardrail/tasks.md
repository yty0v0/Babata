## 1. Product Behavior Freeze

- [x] 1.1 Use one fixed guardrail policy based on the 360 deep-mode boundary
- [x] 1.2 Do not expose standard/deep/aggressive profiles or per-rule toggles in Config
- [x] 1.3 Use a two-stage lifecycle: observation first, enforcement after validation
- [x] 1.4 Define final default as enabled and enforcement

## 2. Configuration Model

- [x] 2.1 Add `HostGuardrailSettings` and include `guardrail` in `HostSettings`
- [x] 2.2 Replace rule switches with fixed deep-mode policy fields
- [x] 2.3 Rename or normalize the lifecycle field to `phase: "observe" | "enforce"`
- [x] 2.4 Keep `auditLogPath` optional and default to the active solver workspace
- [x] 2.5 Normalize missing or invalid phase values to `observe`
- [x] 2.6 Persist phase changes through `/api/config/host-settings`
- [x] 2.7 Add config tests for default phase, phase transitions, and malformed phase input

## 3. Config UI

- [x] 3.1 Add a Guardrail tab to `configTabs`
- [x] 3.2 Simplify `GuardrailPage` to a single enable switch and a phase selector
- [x] 3.3 Remove per-rule switches and profile controls from the page
- [x] 3.4 Show a short fixed description of the deep-mode boundary
- [x] 3.5 Save phase changes through `hostSettings.set`
- [x] 3.6 Add an empty or disabled state when guardrail is off
- [x] 3.7 Verify the page does not expose internal rule configuration

## 4. Deep-Mode Policy Engine

- [x] 4.1 Add guardrail decision and policy types
- [x] 4.2 Add an explicit tool allowlist for deep mode
- [x] 4.3 Block unknown tools when the deep-mode guardrail is active
- [x] 4.4 Implement command tokenization and executable detection
- [x] 4.5 Implement dangerous-write detection
- [x] 4.6 Implement reverse-shell and bind-shell detection
- [x] 4.7 Detect indirect scripts run through bash, python, perl, ruby, and php
- [x] 4.8 Read indirect script bodies and run command rules against their content
- [x] 4.9 Enforce workspace-only file mutations
- [x] 4.10 Inspect written script bodies before allowing write or edit
- [x] 4.11 Inspect read, grep, find, and ls path arguments for sensitive roots
- [x] 4.12 Enforce challenge scope for native network tool targets
- [x] 4.13 Return fail-closed decisions when policy evaluation throws

## 5. Session Integration

- [x] 5.1 Add `safetyGuardrailExtension()` that subscribes to `tool_call`
- [x] 5.2 Read host guardrail settings when creating solver sessions
- [x] 5.3 Inject the guardrail extension before other execution-affecting extensions
- [x] 5.4 Apply the same guardrail to subagent sessions
- [x] 5.5 Pass solver identity, role, challenge id, and phase into the extension options
- [x] 5.6 Keep existing `scopeGuardExtension` behavior when the guardrail is disabled
- [x] 5.7 Preserve observation behavior until phase is changed to enforce

## 6. Audit Event Model

- [x] 6.1 Define `GuardrailAuditEvent` with timestamp, solver id, challenge id, role, tool, rule, decision, reason, and input digest
- [x] 6.2 Define decision values as `observed`, `blocked`, and `allowed`
- [x] 6.3 Use stable JSONL format instead of free-text audit lines
- [x] 6.4 Store events in `workspace/guardrail-audit.jsonl` by default
- [x] 6.5 Add append-only write helper with safe failure handling
- [x] 6.6 Record only observed and blocked violations by default, with optional allowed-event capture

## 7. Audit Storage and Reading

- [x] 7.1 Add a core helper to read one solver's guardrail audit file
- [x] 7.2 Add a core helper to aggregate audit files across a challenge's solver workspaces
- [x] 7.3 Sort events by timestamp and solver id for stable display
- [x] 7.4 Return explicit empty results for missing or corrupt files
- [x] 7.5 Preserve archived solver audit records when solvers are archived

## 8. Server API

- [x] 8.1 Add `GET /api/challenges/:id/guardrail-audit`
- [x] 8.2 Add `GET /api/runtime/solvers/:id/guardrail-audit`
- [x] 8.3 Include solver, challenge, event list, and summary counts in challenge audit response
- [x] 8.4 Return 404 only when the challenge or solver does not exist
- [x] 8.5 Keep audit reads auth-protected through the existing route wrapper

## 9. Challenge Audit UI

- [x] 9.1 Add a Guardrail Audit section or tab to challenge detail
- [x] 9.2 Fetch challenge guardrail audit records on detail load or tab open
- [x] 9.3 Display timestamp, solver, tool, rule, decision, and reason
- [x] 9.4 Provide filters for observed, blocked, and allowed decisions
- [x] 9.5 Show an explicit empty state when no records exist
- [x] 9.6 Add a summary count for observed and blocked events

## 10. Runtime Audit UI

- [x] 10.1 Add a Guardrail Audit section to runtime solver detail
- [x] 10.2 Fetch solver audit records from `/api/runtime/solvers/:id/guardrail-audit`
- [x] 10.3 Display the same event table used by challenge audit
- [x] 10.4 Refresh records after the solver stops

## 11. Observation Phase Verification

- [x] 11.1 Run a DVWA or challenge scenario with guardrail enabled in observe phase
- [x] 11.2 Confirm observed violations are recorded without changing execution
- [x] 11.3 Review false positives against the deep-mode allowlist and command rules
- [x] 11.4 Adjust allowlist or rule false positives before enforcement
- [x] 11.5 Capture a sample challenge with audit records for manual UI verification

## 12. Enforcement Phase Switch

- [x] 12.1 Change default `phase` to `enforce` after observation validation
- [x] 12.2 Verify enforce phase blocks bash, file, network, and unknown-tool violations
- [x] 12.3 Verify blocked events appear in the same audit UI
- [x] 12.4 Ensure guardrail failure during enforcement is fail-closed
- [x] 12.5 Add operator-facing confirmation in Config that enforcement is active

## 13. Tests

- [x] 13.1 Unit-test deep-mode tool allowlist and unknown-tool blocking
- [x] 13.2 Unit-test dangerous write and reverse shell detection
- [x] 13.3 Unit-test indirect script body detection
- [x] 13.4 Unit-test workspace and sensitive-path file rules
- [x] 13.5 Unit-test challenge scope URL validation
- [x] 13.6 Unit-test observe phase records and allows
- [x] 13.7 Unit-test enforce phase records and blocks
- [x] 13.8 Unit-test audit JSONL parsing and corrupt-file handling
- [x] 13.9 Unit-test challenge audit aggregation and sorting
- [x] 13.10 Unit-test server API success and not-found paths
- [x] 13.11 Add frontend component tests for GuardrailPage phase controls
- [x] 13.12 Add frontend component tests for challenge Guardrail Audit table and empty state

## 14. Documentation and Verification

- [x] 14.1 Update `ARCHITECTURE.md` with the guardrail lifecycle and audit flow
- [x] 14.2 Update `AGENTS.md` if operator or solver instructions change
- [x] 14.3 Run `node node_modules/typescript/bin/tsc --noEmit -p packages/core`
- [x] 14.4 Run `node node_modules/typescript/bin/tsc --noEmit -p packages/ui-web`
- [x] 14.5 Run available Bun tests for changed packages
- [x] 14.6 Run `openspec validate add-pluggable-safety-guardrail`
- [x] 14.7 Manually verify observation audit view and final enforcement switch
