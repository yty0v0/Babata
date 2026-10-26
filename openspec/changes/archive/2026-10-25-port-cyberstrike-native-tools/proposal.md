## Why

Current solver sessions rely heavily on `bash` plus model-generated `curl` and Python scripts. In the DVWA runs, this produced scope violations, shell escaping problems, a failed hand-written browser WebSocket script, and low evidence quality. CyberStrike has a mature set of native TypeScript tools that provide structured HTTP replay, specialized attack scripts, browser automation, and structured vulnerability reporting.

The project should absorb the highest-value CyberStrike tool patterns as native tools, adapted to the current scope guard, Taric blackboard, and challenge submission model.

## What Changes

- Add a native `http_replay` tool for structured HTTP mutation, credential reuse, baseline/exploit compare, and raw request replay.
- Add `http_replay_raw` for byte-exact malformed requests, request smuggling, and header-level cases.
- Add `csrf_extract` to fetch and extract CSRF tokens from an authenticated page.
- Add a native `attack_script` dispatcher for JWT tampering, race testing, multipart uploads, SSRF listeners, Wayback endpoint extraction, subdomain takeover, and cloud storage enumeration.
- Add `report_vulnerability` and `triage_vulnerability` for structured findings, duplicate handling, and later challenge report assembly.
- Add a native browser automation tool that wraps the existing browser capability instead of requiring the model to write Python CDP code.
- Add second-phase cloud audit tools for AWS, Azure, GCP, Kubernetes, and CI/CD as native TypeScript tools.
- Integrate all new tools with the current scope guard and Taric artifact/evidence capture.

## Capabilities

### New Capabilities

- `http-replay-tool`: Structured HTTP request replay and mutation without shell-generated curl commands.
- `attack-script-tool`: Native dispatch of approved specialized attack scripts.
- `vulnerability-report-tool`: Structured finding creation, deduplication, and triage.
- `browser-automation-tool`: Native browser navigation, form interaction, request capture, and screenshot capability.
- `cloud-audit-tools`: Native TypeScript cloud, Kubernetes, and CI/CD audit tools.

## Impact

- Affected code: `packages/core/src/config/tools/**`, `packages/core/src/config/index.ts`, `packages/core/src/solver/**`, and prompt/tool metadata.
- New tools become model-callable only when explicitly enabled by prompt metadata or challenge context.
- HTTP tools must respect current scope guard and Taric capture rules.
- Browser tool depends on an available browser runtime; graceful unavailable state is required.
- Cloud tools are best-effort and require the relevant cloud CLIs or credentials already configured by the host.
