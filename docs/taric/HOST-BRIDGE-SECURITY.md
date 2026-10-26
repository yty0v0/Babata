# Host Bridge Security Design (P0.5)

## Status

Implemented as BreachWeave-side hardening before Taric integration.

## Authority

The host is the sole authority for solver identity and role. Model-generated `source`, `role`, `principal_id`, `trust_level`, or similar request fields are never authoritative.

## Roles

| Role | Assignment | Boundary |
| --- | --- | --- |
| planner | Hidden challenge planner prompt, or explicit `prompt.meta.role: planner` | Read challenge/idea/memory state; cannot submit reports or mutate memory/ideas |
| executor | Default non-planner solver, or explicit `prompt.meta.role: executor` | Existing challenge actions, including report submission and board writes |
| observer | Explicit `prompt.meta.role: observer` | Read-only challenge state; cannot submit reports or mutate memory/ideas |
| reviewer | Explicit `prompt.meta.role: reviewer` | Read-only review state; reserved for later independent review |

`prompt.meta.observerEnabled` controls the observer extension in an executor session; it is not solver role assignment. This preserves the current report-submission behavior of prompts that enable an observer extension.

## Action matrix

| Action | planner | executor | observer | reviewer |
| --- | --- | --- | --- | --- |
| challenge_get_state | ✅ | ✅ | ✅ | ✅ |
| challenge_get_hint | ✅ | ✅ | ✅ | ❌ |
| challenge_is_completed | ✅ | ✅ | ✅ | ❌ |
| challenge_submit_report | ❌ | ✅ | ❌ | ❌ |
| challenge_memory_list | ✅ | ✅ | ✅ | ✅ |
| challenge_memory_add | ❌ | ✅ | ❌ | ❌ |
| challenge_idea_list | ✅ | ✅ | ✅ | ✅ |
| challenge_idea_search | ✅ | ✅ | ✅ | ✅ |
| challenge_idea_add | ❌ | ✅ | ❌ | ❌ |

## Request limits

Default policy:

- Request JSON payload: 1 MiB
- Per solver/action: 30 requests per minute
- Per solver concurrent requests: 4
- Handler timeout: 30 seconds

Settings are available under `tch.hostBridge` in global settings:

```json
{
  "tch": {
    "hostBridge": {
      "auditLogPath": "C:/absolute/path/host-bridge-audit.jsonl",
      "requestByteLimit": 1048576,
      "requestsPerMinute": 30,
      "concurrentRequests": 4,
      "timeoutMs": 30000
    }
  }
}
```

Limits cannot disable authorization or auditing. Runtime reload updates the existing policy without resetting active rate/concurrency state.

## Uniform errors

Host Bridge failures sent to solvers use a one-line JSON error:

```json
{"code":"authorization_error","message":"action is not allowed for solver role: challenge_submit_report"}
```

Codes:

- `authorization_error`
- `validation_error`
- `rate_limited`
- `timeout`
- `unavailable`
- `conflict`
- `stale_version`
- `internal_error`

Host Bridge client recognizes these serialized errors and reconstructs a typed `HostBridgeError`.

## Audit

Every request writes JSONL audit records. Authorization denial records one entry; accepted requests write a `received` entry, then `completed` or失败了:

```json
{
  "request_id": "uuid",
  "solver_id": "solver-id",
  "role": "executor",
  "action": "challenge_submit_report",
  "challenge_id": "challenge-id",
  "engagement_id": null,
  "status": "completed",
  "outcome": "success",
  "error_code": null,
  "error_message": null,
  "started_at": "2026-10-23T00:00:00.000Z",
  "completed_at": "2026-10-23T00:00:01.000Z",
  "duration_ms": 1000
}
```

The default path is `~/.tch-agent/logs/host-bridge-audit.jsonl`. Audit write failure returns `unavailable` and is fail-closed for the request; correlation and audit integrity are preferred over proceeding without a record.

## Challenge → Engagement binding

Each challenge will have a dedicated binding file:

```text
<challenge>/<challenge-id>/taric/binding.json
```

States:

- `pending`: binding created, Taric engagement not initialized
- `active`: challenge is bound to one engagement
- `failed`: initialization or validation failed; no automatic fallback to another engagement

Required fields for `active`:

```json
{
  "challenge_id": "web-001",
  "engagement_id": "01a167a1-521e-7ef1-88d0-ef049c750502",
  "status": "active",
  "scope_snapshot": {
    "allowed_targets": ["https://example.test"],
    "excluded_targets": [],
    "rules_of_engagement_ref": "roe:web-001"
  },
  "taric_refs": {
    "engagement_record_id": "01a167a1-521e-7ef1-88d0-ef049c750502"
  },
  "created_at": "2026-10-23T00:00:00.000Z",
  "updated_at": "2026-10-23T00:00:00.000Z"
}
```

Only the host reads and writes this binding. Cross-engagement access must fail with `authorization_error`, even if the caller knows another engagement id.

## Not implemented yet

- HTTP sidecar and Taric transport (P1)
- Taric proposal governance (P1b/P2)
- WorkRun/checkpoint operations (P3)
