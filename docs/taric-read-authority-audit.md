# Taric read authority and runtime audit

> Audit scope: the `optimize-taric-read-provider` change. This document records the current authority boundary and the compatibility behavior after the read-adapter changes.

## 1. Call-path map

| Concern | Current path | Authority / boundary |
|---|---|---|
| Daemon composition | `packages/core/src/index.ts` | Reads Taric settings, checks Docker/image/digest/volume/authority readiness, then wires the sidecar, host module, provider factory, and status surface. It does not create, reset, or migrate the authority volume. |
| Docker/runtime readiness | `packages/core/src/challenge/taric-runtime-readiness.ts` | Read-only prerequisite checks. Missing Docker, image/digest mismatch, missing volume, or unhealthy authority produces bounded failure state. |
| Loopback read transport | `packages/core/src/challenge/taric-read-board.ts` and `taric-http-sidecar.ts` | Host-controlled allowlisted operations only. Model input cannot supply trusted engagement/project/tenant identity; transport failures become redacted diagnostic codes. |
| Taric memory/ideas read adapter | `packages/core/src/challenge/taric-memory-provider.ts` | The sole authority for `taric_best_effort` and `taric_required` project scopes. It reads canonical claims plus candidate proposals under one validated composite project scope and one `read_seq` watermark. |
| Provider routing | `packages/core/src/challenge/manager.ts` | `legacy_local` explicitly selects the file provider. Any other project memory mode requires the Taric provider factory; provider creation/read failure is not redirected to local JSON. |
| Host Bridge reads | `packages/core/src/challenge/host-bridge-handler.ts` | Uses one board read for memory/ideas and forwards `read_diagnostics`; search results also carry the current read diagnostics. |
| REST/UI reads | `packages/ui-web/src/server.ts`, `src/lib/api.ts`, challenge board components | Managed Taric projects use the provider board snapshot; legacy Taric projection compatibility is retained only for explicitly non-project-managed bindings. Incomplete reads are visible as warnings, not empty-success state. |
| Solver context | `packages/core/src/solver/extension/challenge-observer/tools.ts` | Local solver board and challenge-global board remain separate. Partial/failed challenge reads produce warning text and structured diagnostics. |
| Writes/governance | `taric-work-manager.ts`, `taric-authoritative-state.ts`, proposal/outbox/evidence modules | Unchanged host-owned lifecycle. The read adapter does not grant proposal admission, checkpoint, evidence, report, or WorkRun write authority. |

## 2. Authority rules

1. A challenge with `project.memory_mode === "legacy_local"`, or without a project record, uses the existing challenge-scoped local provider.
2. A challenge with any Taric memory mode uses Taric through the host-validated composite project key. The local JSON provider is not an outage fallback.
3. A missing binding, disabled/unhealthy Taric runtime, invalid response, timeout, pagination conflict, or read budget exhaustion is represented as an error or bounded degraded/partial diagnostic. It is never converted into a successful empty authoritative board.
4. Caller/model values for `challenge_id`, `project_id`, `project_key`, `tenant_id`, `engagement_id`, `principal_id`, `solver_id`, and role are not accepted as trusted scope. Taric host bindings supply identity and the adapter rechecks the project key and engagement.
5. Existing Taric data is preserved. Startup checks adopt valid existing runtime state and never remove/recreate the named authority volume.

## 3. Startup and reference-runtime comparison

The reference BreachWeave implementation contributes the useful supervisor pattern: automatic startup, idempotent adoption, bounded readiness, and persistent runtime state. This project applies that pattern at the Docker boundary rather than copying the reference process-local fallback:

- startup is owned by the daemon composition root;
- Docker Engine, configured image/digest, named volume, and Taric authority health are checked before readiness is exposed;
- the loopback sidecar is started/adopted automatically when enabled;
- a Taric-managed read never switches to local JSON when the authority is unavailable;
- explicit legacy-local projects retain compatibility without becoming a Taric outage fallback.

## 4. Baseline and migration boundary

| Situation | Expected result |
|---|---|
| Explicit legacy-local project | Existing local board behavior. |
| Taric project with healthy binding | Bounded canonical + candidate Taric read with stable provenance and diagnostics. |
| Taric disabled/unavailable/unhealthy | Explicit unavailable/degraded or blocked result; no local fallback. |
| Missing or mismatched binding | Validation/binding failure; no default or cross-challenge scope. |
| Malformed pagination/response | Typed validation/conflict/timeout failure; no successful empty authority result. |
| Existing authority volume | Reused after readiness checks; not reset or migrated implicitly. |

No local archive, Taric volume, authority record, or historical test dataset is deleted or migrated by this change. Destructive cleanup remains a separately approved operation.
