## Context

The agent already has several safety mechanisms, but they are not a single pluggable layer:

- `scope-guard.ts` enforces run-policy targets and some command restrictions for solver sessions.
- Native tools such as `http_replay` and `native_runtime` perform their own `assertInScope` checks.
- `run-policy.json` carries allowed targets and forbidden command names.
- Prompts and skills carry behavioral guidance only.

The requested change adds a host-level guardrail configuration and a shared pre-execution evaluator while keeping the existing mechanisms intact when the guardrail is disabled.

## Goals / Non-Goals

**Goals:**

- Make safety enforcement selectable without changing code.
- Provide one shared evaluator for tool traffic.
- Use one fixed deep-mode policy with an observation phase and an enforcement phase.
- Record decisions for later review.
- Apply to solver and subagent sessions.
- Expose recorded decisions in the challenge and runtime detail UI.

**Non-Goals:**

- Do not introduce a Go daemon or network proxy in this phase.
- Do not guarantee that arbitrary binaries spawned by bash cannot bypass the tool gate.
- Do not remove existing run-policy and Taric scope checks.
- Do not change default tool availability.

## Decisions

### Decision 1: Host settings carry the guardrail config

Add `HostGuardrailSettings` to `packages/core/src/config/types.ts` and expose it as `HostSettings.guardrail`.

Rationale: Host settings already persist in `~/.tch-agent/config/settings.json`, are loaded by `ConfigManager`, are exposed through `/api/config/host-settings`, and are mounted into solver containers.

Alternative: Create a separate guardrail JSON file and API. This adds more plumbing without a strong need.

### Decision 2: One fixed deep-mode policy with a lifecycle phase

The guardrail has one policy: the 360-style deep-mode boundary. The Config UI exposes only enable/disable and a lifecycle phase of `observe` or `enforce`.

Rationale: The operator should not have to assemble policy rules. A single boundary keeps behavior predictable, while the phase allows validation before blocking.

Alternative: Expose multiple profiles or per-rule switches. This increases configuration surface and makes enforcement harder to reason about.

### Decision 3: Use a pi `tool_call` extension as the pre-execution gate

Create `safetyGuardrailExtension()` and include it at the start of `extensionFactories` in both `createSolverSession` and `createSubagentSession` when enabled.

Rationale: The pi coding agent invokes `tool_call` handlers before execution and supports returning `{ block: true, reason }`. The config directory is mounted into solver containers, so no extra cross-process transport is required.

Alternative: Wrap each tool definition. This is more invasive and easier to miss for new tools.

### Decision 4: Keep the evaluator policy-driven and shared

Implement a pure evaluator that receives the tool name, input, workspace root, and active policy, and returns a normalized decision. Both the extension and native network tools call this evaluator.

Rationale: Sharing the evaluator prevents drift between the preflight gate and internal tool-level checks.

Alternative: Keep `assertInScope` duplicated in each tool. This is the current source of inconsistency.

### Decision 5: Reuse reference deep-mode rules, adapted to local tools

Port the rule families from the reference scope-guard implementation: command shape checks, script body checks, sensitive roots, workspace bounds, dangerous writes, and reverse shells. Native tools additionally call the shared target checker for URLs.

Rationale: The reference rules are proven and directly relevant.

Alternative: Invent a smaller rule set. This would likely miss important high-risk actions.

### Decision 6: Structured JSONL audit in the solver workspace

Write decisions to `workspace/guardrail-audit.jsonl` by default. Each line is a structured `GuardrailAuditEvent` with timestamp, solver id, challenge id, role, tool, rule, decision, reason, and input digest.

Rationale: JSONL is easy to append from the solver, easy to parse from the host API, and easy to aggregate across archived solver directories.

Alternative: Reuse the existing free-text `audit.log`. This is harder to parse and does not support the required UI filters.

### Decision 7: Host reads and aggregates solver audit files

The host API reads guardrail audit files from active and archived solver workspaces. A challenge endpoint aggregates records for all solvers belonging to that challenge. A runtime endpoint returns records for one solver.

Rationale: Solver containers are disposable, so audit data must live in a mounted workspace that the host can read after the container stops.

Alternative: Stream audit records from solver to host in real time. This adds a new transport and ordering model before the basic review use case is proven.

### Decision 8: Observation first, enforcement as the final default

Ship with `phase: "observe"` during validation. After false positives are reviewed and tests pass, change the default to `phase: "enforce"`.

Rationale: This matches the requested rollout: first observe and collect records, then enable actual blocking without changing the policy shape.

Alternative: Ship enforcement immediately. This risks blocking legitimate pentest tooling before the allowlist is validated.

## Risks / Trade-offs

- [A rule can miss an obfuscated bash payload] -> Use layered checks and treat this phase as application-level enforcement, not OS isolation.
- [Observe mode may produce noisy logs] -> Include rule IDs and make log output compact.
- [A solver started before a settings change keeps the old policy] -> Accept stale session behavior; document that settings apply to new sessions.
- [Native tools may be called outside the agent event path] -> Also call the shared evaluator inside their execute functions.
- [Enforce phase may reduce successful exploitation] -> Use the observation phase to tune the fixed allowlist before promoting to enforcement.
- [Unknown-tool blocking may be noisy] -> Record rule IDs and tool names so false positives can be identified in the audit UI.

## Migration Plan

1. Simplify the config and UI to one deep-mode policy plus a lifecycle phase.
2. Implement the full deep-mode evaluator: tool allowlist, command rules, indirect scripts, file bodies, sensitive paths, and scope.
3. Write structured JSONL audit events in the solver workspace.
4. Add host APIs for challenge-level and solver-level audit records.
5. Add Guardrail Audit views to challenge detail and runtime solver detail.
6. Validate the observation phase with a DVWA or challenge run.
7. Promote the default phase to enforcement after false-positive review.

## Open Questions

- Should allowed events be written by default, or only observed and blocked events?
- Should the challenge audit view include archived solvers by default, or require an explicit archive filter?
