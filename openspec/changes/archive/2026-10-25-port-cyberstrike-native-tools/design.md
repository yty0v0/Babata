## Context

Current model-callable tools are mainly SDK file/bash tools, challenge report tools, Taric read/proposal tools, and the new skill tool. Attack execution usually falls back to `bash`, which lets the model construct arbitrary commands. This caused:

- Shell escaping and encoding mistakes.
- Scope guard rejections from broad commands.
- Generated Python scripts with runtime bugs.
- Weak evidence capture because output is just command text.

CyberStrike already has native tool implementations for the same workflows. This change adapts those patterns rather than copying the entire tool registry.

## Goals / Non-Goals

**Goals:**

- Replace common ad-hoc `curl` and Python attack workflows with structured native tools.
- Keep tool parameters narrow and validated.
- Capture request/response evidence in a structured form suitable for Taric artifact binding.
- Preserve the current scope guard and challenge authorization boundaries.
- Provide graceful failures when optional dependencies are missing.

**Non-Goals:**

- Do not copy the entire CyberStrike tool registry or its session database.
- Do not replace the existing Taric, challenge, skill, or subagent architecture.
- Do not introduce Playwright or a new browser dependency without an explicit runtime requirement.
- Do not execute cloud mutations by default; cloud tools are read-only audit tools unless host policy allows otherwise.

## Decisions

### Decision 1: Start with HTTP replay and attack scripts

The first wave ports `http_replay`, `http_replay_raw`, `csrf_extract`, and `attack_script`. These directly target the highest-frequency attack loops in DVWA and CTF tasks.

Rationale: HTTP requests and specialized crypto/concurrency operations are the most error-prone when written by the model.

Alternative: Port browser automation first. Browser is useful but less critical for the current API/Web testing loop.

### Decision 2: Native TypeScript tool surface, not shell aliases

Each new tool defines typed parameters and performs work in TypeScript or a controlled subprocess. It does not expose arbitrary shell strings.

Rationale: Typed parameters reduce injection and scope mistakes and produce structured outputs.

Alternative: Wrap `curl` in a tool. This preserves most escaping and scope problems.

### Decision 3: HTTP replay uses captured requests plus explicit targets

The tool supports two modes:

- Replay a captured request by ID, carrying original URL, method, headers, credentials, and cookies.
- Construct a request to a target path on an already in-scope host.

Rationale: Captured request IDs avoid manual URL reconstruction, while target mode covers inferred endpoints.

Alternative: Require raw URL for every request. This reintroduces host and credential mistakes.

### Decision 4: Attack scripts use a fixed allowlist

The dispatcher only allows known scripts such as JWT tamper, race tester, multipart upload, SSRF listener, Wayback extraction, subdomain takeover, and cloud storage enumeration.

Rationale: Fixed allowlist keeps specialized operations safe and auditable while preventing arbitrary script execution.

Alternative: Allow arbitrary Python files. This defeats the purpose and reintroduces generated-script failures.

### Decision 5: Structured findings feed the report path

`report_vulnerability` stores a structured finding. `triage_vulnerability` resolves duplicates. The challenge report remains the final submission, but it can be assembled from structured findings.

Rationale: Structured findings improve evidence quality and duplicate handling without changing the existing challenge scoring interface.

Alternative: Replace `challenge_submit_report` entirely. This risks breaking current challenge integration.

### Decision 6: Browser automation wraps an existing runtime

Use the current `agent-browser` skill as the preferred runtime, but expose a native tool with navigation, snapshot, fill, click, screenshot, and request capture. If the runtime is unavailable, return a structured unavailable result.

Rationale: This gives the model a stable interface without introducing Playwright or rewriting browser automation.

Alternative: Implement Playwright. It adds a heavy dependency and is not currently installed.

### Decision 7: Cloud tools are phase two and read-only

Port cloud audit tools only after the first wave is stable. They call `aws`, `az`, `gcloud`, `kubectl`, or CI CLIs when available and return structured results.

Rationale: Cloud tools are valuable but depend on external credentials and are lower frequency for the current local challenge testing.

Alternative: Port all tools now. This increases scope and testing surface without immediate value.

## Risks / Trade-offs

- [New tools may be ignored by the model] -> Enable them through prompt metadata and evidence prompt guidance.
- [Native tool outputs may still be large] -> Enforce bounded summaries and Taric artifact spooling.
- [Browser runtime may be missing] -> Provide graceful unavailable output and keep bash fallback only when safe.
- [Cloud tools may expose credentials] -> Redact secrets and require read-only CLI invocations by default.
- [Tool set may overlap with existing `security_kimi_search`] -> Keep search separate; new tools are execution tools, not search tools.

## Migration Plan

1. Implement HTTP replay and attack script tools behind explicit prompt tool metadata.
2. Add structured vulnerability tools and connect them to challenge reporting.
3. Add browser automation tool with graceful fallback.
4. Add cloud audit tools behind optional provider configuration.
5. Validate each phase with DVWA and unit tests before expanding.

## Open Questions

- Should `http_replay` be the only HTTP execution path for challenge sessions, or remain one option?
- Should browser automation use `agent-browser` CLI or a future bundled Chromium runtime?
- Should cloud audit results write directly into Taric observations, or first return structured findings to the model?
- Should `attack_script` scripts be vendored in this repository or resolved from a configured runtime directory?
