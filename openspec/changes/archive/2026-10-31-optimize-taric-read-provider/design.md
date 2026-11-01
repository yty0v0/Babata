## Context

The host is a Bun/TypeScript application. Challenge memory and ideas currently have local JSON compatibility paths, while Taric-managed scopes use Taric authoritative projections and a restricted Host Bridge/read-board. The reference project supervises a local Taric gateway during daemon startup and stores its authority in a stable local directory. This project invokes Taric through Docker and a persistent named volume, so the lifecycle pattern must be adapted rather than copied literally.

Before coding, trace the actual runtime paths separately: read-board Host Bridge handler, Taric memory/ideas projections, ChallengeManager APIs, solver context-pack construction, and Docker invocation. For each path identify caller, trusted identity source, scope source, response shape, failure semantics, and whether partial data is safe to consume. Do not merge similarly named paths without verifying runtime wiring.

## Goals / Non-Goals

### Goals
- Every Taric paginated read has hard termination and resource budgets.
- Pages in one snapshot read have a consistent `read_seq` where supported by the upstream contract; cursors demonstrably advance; duplicate handling is deterministic.
- Partial/degraded outcomes remain visible to UI, API, and solver context consumers.
- Taric is the sole persistence authority for Taric-managed memory/ideas. The read adapter is an integration boundary, not a choice between Taric and local persistence.
- Taric-managed reads remain scoped to host-validated challenge and active engagement bindings; missing bindings fail closed without cross-scope or local fallback.
- Taric access components are initialized automatically and idempotently at application startup, with an explicit readiness check before Taric operations are reported healthy.
- Existing explicit legacy-local compatibility remains isolated to legacy scopes and is never selected because Taric is unavailable.
- Existing host-owned authority writes and governance flows are unchanged.

### Non-Goals
- Creating a project identity system or guessing challenge-to-project/tenant mappings.
- Hiding authorization/runtime errors behind local-provider fallbacks or empty success responses.
- Starting, installing, or managing the privileged Docker Engine/desktop service from the application.
- Changing unrelated HTTP APIs or exposing raw artifact bytes.
- Changing Taric permissions, report gates, or model tool allowlists.

## Decisions

### 1. Deliver in gated phases
First harden read-board pagination and diagnostics with isolated tests. Then introduce a typed Taric read adapter and migrate verified memory/ideas read call sites. In parallel, add the automatic startup/readiness lifecycle. The adapter is read-only: proposal submission, admission, WorkRun/checkpoint writes, evidence binding, and report approval remain on existing host-controlled paths.

### 2. Use bounded, trusted pagination policy
Centralize limits for pages, records, aggregate response bytes, cursor length, per-request timeout, and overall deadline. Apply safe defaults and hard ceilings when reading host configuration. Model requests cannot raise these budgets. Invalid configuration falls back to a safe default and produces a bounded diagnostic.

### 3. Enforce consistency and cursor progress
The first valid page establishes `read_seq`; later pages must match when the Taric API guarantees snapshot semantics. Cursors must have the expected type and length, must not repeat, and each nonterminal page must make progress. Empty pages with an unchanged cursor terminate with a protocol diagnostic. Deduplicate by stable record ID while preserving first-seen order; missing stable IDs follow the verified endpoint contract and are not silently dropped.

### 4. Make completeness explicit
Return an equivalent of `complete`, `partial`, or `degraded`, along with bounded diagnostic codes and counters for pages, records, bytes, read sequence, and termination reason. On sequence drift or protocol failure, never label mixed/incomplete records as a complete snapshot. Each consumer must explicitly decide whether to show/use a partial prefix or fail closed.

### 5. Keep Taric authoritative; use an adapter, not backend selection
Define a typed interface for challenge-scoped Taric memory/ideas reads and their provenance, completeness, and diagnostics. Resolve the Taric transport/adapter from trusted host configuration at the composition root; services should not depend on Taric HTTP/Docker details. Taric-managed scopes always use Taric as authority. Legacy JSON may remain only for explicitly legacy scopes/compatibility and must never be an automatic outage fallback. Do not accept caller-supplied project/tenant/engagement scope as authority.

### 6. Automatically initialize and verify Taric runtime
At daemon startup, idempotently initialize the Taric access components required by the configured deployment: start the loopback sidecar when required, verify Docker Engine is reachable, verify the configured Taric image and persistent named volume, and perform a host-controlled Taric authority health check. Reuse existing runtime/data when valid. Never delete or reset the authority volume. Docker Engine is an external prerequisite and is not started through privileged service management by the application. If prerequisites or health checks fail, expose a clear unavailable/degraded state and block Taric-governed operations; do not silently route them to local JSON. The UI may remain available for diagnostics.

### 7. Preserve compatibility without hiding degraded state
Keep existing API/IPC/UI fields where safe and adapt explicitly. If a legacy consumer cannot represent partial results, return an explicit safe failure/degraded state rather than stripping completeness and continuing as if the data were complete.

### 8. Defer project-bound mode
A future project-bound change must define trusted challenge-to-tenant/project/engagement provisioning, principal/token lifecycle and rotation, authorization boundaries, auditability, migration, and cross-project tests. Until then, configuration/provider construction for project-bound mode fails closed.

## Risks / Trade-offs

- Taric and legacy JSON projection schemas may differ. Use explicit adapters and do not infer trust levels from legacy fields.
- Startup checks add latency. Bound each probe, report progress, and avoid repeated image pulls; image installation/pull policy remains explicit and must not occur unexpectedly.
- A healthy Docker daemon does not prove Taric authority readiness. Require a successful host-controlled Taric authority health operation, not only a TCP/listener probe.
- Taric outage must not create split-brain persistence. Taric-managed reads/writes stay unavailable or degraded until Taric recovers; existing encrypted outbox behavior remains the only approved deferred-write mechanism.
- Startup initialization must be idempotent across restarts and concurrent daemon starts, and must preserve volume contents.

## Verification Strategy

Use unit tests with injected Docker/runtime/health probes for startup success, existing-runtime adoption, timeout, unavailable Docker, missing image, volume verification, health failure, and idempotent retries. Use pagination fixtures for budget exhaustion, repeated cursor, sequence drift, duplicates, oversized responses, and malformed pages. Add integration tests proving Taric-managed scopes never call local JSON on an outage and proving explicit legacy scopes retain compatibility. Run relevant Bun tests, core typecheck/build, and strict OpenSpec validation. Do not perform destructive volume migration or authority reset as part of this change.
