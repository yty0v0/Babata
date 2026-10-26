## Why

The current pentest flow relies mostly on prompt-level safety guidance plus a few hardcoded checks in `scope-guard.ts`, `run-policy.json`, and individual native tools. That makes safety behavior implicit, inconsistent, and impossible to tune without editing code. The project needs a pluggable code-level guardrail that can be enabled from Config and that inspects every tool call before execution without permanently reducing testing capability.

## What Changes

- Add a `safety-guardrail` capability with one fixed 360-style deep-mode policy and an `observe`/`enforce` lifecycle phase.
- Add a `guardrail` section to host settings, exposed from the existing Config host-settings API.
- Add a Guardrail tab under Config with only an enable switch and a lifecycle phase selector.
- Add a shared deep-mode evaluator for tool allowlisting, bash commands, indirect scripts, file bodies, sensitive paths, dangerous writes, reverse shells, and network target scope.
- Inject the guardrail extension into solver and subagent sessions only when enabled.
- Route native HTTP, browser, attack-script, and runtime network tools through the same evaluator.
- Persist structured guardrail decisions in JSONL and expose them in challenge and runtime detail views.

## Capabilities

### New Capabilities

- `safety-guardrail`: A pluggable code-level gate that applies one fixed deep-mode policy before execution, records decisions, supports observation before enforcement, and exposes audit records after test runs.

### Modified Capabilities

None.

## Impact

- Affected code: `packages/core/src/config/types.ts`, `packages/core/src/config/index.ts`, `packages/core/src/solver/session.ts`, `packages/core/src/solver/extension/**`, `packages/core/src/config/tools/**`, `packages/ui-web/src/data/app-nav.ts`, `packages/ui-web/src/components/config/**`, `packages/ui-web/src/server.ts`, and `packages/ui-web/src/lib/api.ts`.
- Existing tools keep their current behavior when the guardrail is disabled.
- The observation phase records would-block decisions without changing execution.
- The enforcement phase blocks violating tool calls before execution and records them for later review.
- Running solvers use the config present at session creation; newly started solvers pick up saved settings.
- The final rollout default is enforcement after the observation phase has been validated.
