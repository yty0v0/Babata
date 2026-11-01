## 1. Runtime and authority audit

- [x] 1.1 Trace current Taric read-board, memory/ideas read and write, local JSON, Docker invocation, and daemon startup call paths; record which component is authoritative for each data class.
- [x] 1.2 Compare the reference project's startup supervisor with this project's Docker-backed runtime. Reuse idempotent start/adopt/readiness concepts, not its legacy-local outage fallback.
- [x] 1.3 Identify every Taric-managed call site and confirm no caller-provided challenge/project/tenant/engagement value is treated as authority.
- [x] 1.4 Inventory existing Taric configuration, image digest policy, named volume, sidecar, health endpoints, startup scripts, and compatibility settings.
- [x] 1.5 Record baseline behavior for explicit legacy scopes, Taric-available scopes, Taric-unavailable scopes, missing bindings, and malformed settings.
- [x] 1.6 Document migration boundaries: this change must not delete local archives, reset Taric volumes, or migrate authority data implicitly.

## 2. Bounded read-board behavior

- [x] 2.1 Define typed read limits for pages, records, aggregate bytes, cursor length, request timeout, and total deadline, with safe defaults and hard ceilings.
- [x] 2.2 Validate model/request pagination inputs so they cannot raise host budgets or change trusted scope.
- [x] 2.3 Implement cursor shape/length validation, repeated-cursor detection, non-progress detection, and a hard request-count bound.
- [x] 2.4 Enforce stable `read_seq` across pages when guaranteed by the upstream contract; stop on drift or invalid sequence.
- [x] 2.5 Deduplicate by stable record identity without silently dropping records that lack a required identity field.
- [x] 2.6 Enforce aggregate response-size limits before retaining or forwarding additional pages.
- [x] 2.7 Return typed complete/partial/degraded state, stable diagnostic codes, and bounded counters/termination reason.
- [x] 2.8 Map completeness and failures through Host Bridge, service, API, UI, and solver context without exposing secrets or raw authority contents.
- [x] 2.9 Add pagination fixtures for normal completion, many pages, repeated/oversized cursors, sequence drift, duplicates, malformed responses, request timeout, and byte/page budgets.
- [x] 2.10 Verify disabled/unavailable Taric and missing binding produce explicit state and never trigger cross-challenge or local fallback for Taric-managed scopes.

## 3. Automatic Taric runtime startup and readiness

- [x] 3.1 Define startup lifecycle ownership in the daemon composition root; initialize required Taric access components automatically without requiring a manual Taric launch command.
- [x] 3.2 Make startup idempotent: safely reuse a valid sidecar/runtime and persistent named volume; avoid duplicate listeners and concurrent initialization races.
- [x] 3.3 Add bounded Docker Engine availability checks with a clear diagnostic when Docker Desktop/Engine is not running; do not attempt privileged service installation/startup.
- [x] 3.4 Verify the configured Taric image/reference and required digest policy before exposing Taric as ready; do not silently pull an unpinned or unexpected image.
- [x] 3.5 Verify the expected persistent volume exists/is usable and is the configured authority store; never remove, recreate, or reset it during startup.
- [x] 3.6 Start the loopback sidecar when configured/required and wait for host-controlled Taric authority readiness, not merely a local TCP listener.
- [x] 3.7 Expose startup/health status and actionable bounded diagnostics; keep non-Taric diagnostics UI available where safe.
- [x] 3.8 Define outage behavior: Taric-governed operations return explicit unavailable/degraded or blocked results according to policy and do not fall back to local JSON.
- [x] 3.9 Test startup on first run, subsequent run/adoption, concurrent initialization, Docker unavailable, missing/mismatched image, volume issue, sidecar failure, health timeout, and recovery/retry.
- [x] 3.10 Update local deployment documentation with Docker Engine prerequisite, automatic app startup behavior, persistent volume location/name, and recovery guidance.

## 4. Taric read adapter and compatibility boundary

- [x] 4.1 Define a typed read adapter contract for challenge scope, host-validated binding, role context, read options, provenance, completeness, and diagnostics.
- [x] 4.2 Define stable outcomes for unavailable, invalid binding, authorization failure, partial response, invalid response, and explicit legacy scope; never encode failures as successful empty authority data.
- [x] 4.3 Implement the Taric adapter over authoritative projections and validated host bindings. This adapter is the sole memory/ideas authority for Taric-managed scopes.
- [x] 4.4 Keep any local JSON compatibility path restricted to explicitly legacy-local scopes; it is not selectable for Taric-managed scopes and cannot be used on Taric failure.
- [x] 4.5 Construct the adapter at the daemon composition root while keeping Taric transport and Docker details out of ChallengeManager/UI business logic.
- [x] 4.6 Reject or ignore caller-supplied mismatched scope and test that missing bindings cannot fall back to a default challenge or engagement.
- [x] 4.7 Preserve existing host-owned write permissions and governance lifecycle; the read adapter grants no proposal, admission, checkpoint, evidence, or report-write authority.
- [x] 4.8 Adapt current REST/IPC/UI response types explicitly; propagate read diagnostics metadata without changing existing memory/ideas fields.
- [x] 4.9 Migrate verified memory/ideas read call sites and remove only proven-dead duplicate read implementations after reference checks.
- [x] 4.10 Update exports/types and verify one-way dependency flow with no circular imports.

## 5. Regression and acceptance verification

- [x] 5.1 Unit-test Taric pagination and adapter success, provenance, partial state, failures, authorization errors, and invalid payloads.
- [x] 5.2 Test that Taric-managed scopes never read local JSON when Taric is disabled, unavailable, unhealthy, or missing a binding.
- [x] 5.3 Test that explicit legacy-local scopes retain their documented compatibility behavior without becoming a fallback for Taric scopes.
- [x] 5.4 Test startup/readiness reporting at runtime-check boundary and verify degraded read errors use stable redacted diagnostic codes, never raw transport details.
- [x] 5.5 Regress WorkRun/checkpoint/evidence admission, proposal, recovery, repair, and report gates; confirm the read adapter adds no write capability.
- [x] 5.6 Run relevant Bun tests, core/workspace typecheck and build; distinguish environment/dependency failures from code failures.
- [x] 5.7 Validate documentation, changed configuration defaults, diagnostics, and strict OpenSpec requirements.
- [x] 5.8 Run `openspec validate optimize-taric-read-provider --strict`; leave destructive migration, volume reset, or authority writes outside this plan unless separately approved.

