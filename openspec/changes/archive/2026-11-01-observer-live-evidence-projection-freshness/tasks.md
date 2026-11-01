## 1. Contract and lifecycle

- [x] 1.1 Confirm and test ordering between successful `challenge_submit_report` host checkpoint/evidence binding and Observer `tool_execution_end` scheduling.
- [x] 1.2 Update Observer review contract so stale/degraded/pending evidence visibility cannot be interpreted as `NO_CHANGE`.
- [x] 1.3 Preserve the real-Taric-record UUID invariant; add regression coverage rejecting artifact IDs/hashes as evidence refs.

## 2. Projection freshness

- [x] 2.1 Integrate bounded host Taric reconciliation into the model read-board path for the bound engagement; require the capability whenever Taric is enabled.
- [x] 2.2 Return a stable bounded degraded response when reconciliation is unavailable/fails or watermark parity/pending-outbox checks do not establish freshness.
- [x] 2.3 Add focused tests for replay-to-fresh, persistent lag, reconciliation failure, missing watermarks, and no stale empty success.
- [x] 2.4 Defer runtime-wide freshness status diagnostics: current status has no reliable engagement-scoped watermark source; track as a separate follow-up.

## 3. Verification

- [x] 3.1 Run focused Observer, evidence-binding, read-board, maintenance, and status tests.
- [x] 3.2 Run typecheck and OpenSpec validation for this change.
- [x] 3.3 After approved deployment/restart, replay the scoped DVWA task and verify evidence UUID visibility, candidate behavior, and committed/projected parity; do not declare end-to-end success unless all checks pass.
