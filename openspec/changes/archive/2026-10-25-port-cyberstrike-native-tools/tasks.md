## 1. Tool inventory and compatibility

- [x] 1.1 Record the current model-callable tools and identify which workflows fall back to bash/curl/python
- [x] 1.2 Map CyberStrike tools to current challenge/Taric/scope-guard integration points
- [x] 1.3 Define the first-wave tool list: `http_replay`, `http_replay_raw`, `csrf_extract`, `attack_script`
- [x] 1.4 Define the second-wave tool list: `report_vulnerability`, `triage_vulnerability`, browser automation
- [x] 1.5 Define the third-wave tool list: cloud, Kubernetes, and CI/CD audit tools

## 2. HTTP replay foundation

- [x] 2.1 Add captured-request data types for method, URL, headers, credentials, cookies, and body
- [x] 2.2 Add mutation operation types for path, query, header, cookie, and body fields
- [x] 2.3 Implement `http_replay` request construction and execution
- [x] 2.4 Implement baseline/exploit compare mode with structured response diff
- [x] 2.5 Implement in-scope target mode that refuses out-of-scope hosts
- [x] 2.6 Implement `http_replay_raw` with byte-exact send
- [x] 2.7 Return bounded response summaries and original evidence references

## 3. CSRF extraction

- [x] 3.1 Implement authenticated page fetch using captured credential context
- [x] 3.2 Extract CSRF token from common fields, meta tags, and headers
- [x] 3.3 Return token field name, value, and source hint for replay
- [x] 3.4 Handle missing token with explicit not-found result

## 4. Attack script dispatcher

- [x] 4.1 Define the fixed script allowlist and typed parameter schemas
- [x] 4.2 Implement dispatcher routing for JWT, race, upload, SSRF listener, Wayback, subdomain takeover, and cloud storage
- [x] 4.3 Resolve scripts from a controlled runtime directory or vendored asset path
- [x] 4.4 Prevent arbitrary script or shell text execution
- [x] 4.5 Return structured output and evidence file references
- [x] 4.6 Add timeout, cancellation, and bounded output handling

## 5. Structured vulnerability reporting

- [x] 5.1 Add `report_vulnerability` typed schema
- [x] 5.2 Store findings in an append-only structured format
- [x] 5.3 Add similarity detection for duplicate candidates
- [x] 5.4 Add `triage_vulnerability` approve/duplicate flow
- [x] 5.5 Keep duplicate findings linked instead of dropped
- [x] 5.6 Allow final challenge report assembly to consume structured findings

## 6. Browser automation tool

- [x] 6.1 Define typed browser actions: open, snapshot, click, fill, submit, screenshot
- [x] 6.2 Wrap the existing agent-browser or tch-headless runtime
- [x] 6.3 Return interactive element references and page state
- [x] 6.4 Capture browser requests into structured replay evidence
- [x] 6.5 Return explicit unavailable state when browser runtime is missing
- [x] 6.6 Respect scope guard for every navigation

## 7. Tool registration and prompt enablement

- [x] 7.1 Add first-wave tools to `packages/core/src/config/tools`
- [x] 7.2 Register tools in `ConfigManager` with clear source labels
- [x] 7.3 Add prompt metadata helpers for enabling tool groups
- [x] 7.4 Update evidence prompt to prefer native HTTP tools over bash curl
- [x] 7.5 Ensure Taric-enabled sessions capture native tool outputs as evidence
- [x] 7.6 Keep legacy bash fallback only where no native tool is applicable

## 8. Cloud audit tools

- [x] 8.1 Implement provider availability detection
- [x] 8.2 Implement AWS read-only audit commands
- [x] 8.3 Implement Azure read-only audit commands
- [x] 8.4 Implement GCP read-only audit commands
- [x] 8.5 Implement Kubernetes read-only audit
- [x] 8.6 Implement CI/CD audit
- [x] 8.7 Return structured provider findings and unavailable states

## 9. Scope, safety, and Taric integration

- [x] 9.1 Apply existing scope guard to all native HTTP and browser tools
- [x] 9.2 Redact credentials and authorization headers in tool results
- [x] 9.3 Route large tool outputs to Taric artifacts
- [x] 9.4 Ensure cloud tools are read-only by default
- [x] 9.5 Add host policy support for optional cloud mutation

## 10. Tests

- [x] 10.1 Unit-test HTTP replay mutation and compare modes
- [x] 10.2 Unit-test raw request preservation
- [x] 10.3 Unit-test scope guard rejection for out-of-scope targets
- [x] 10.4 Unit-test CSRF extraction success and not-found
- [x] 10.5 Unit-test attack script allowlist and parameter validation
- [x] 10.6 Unit-test structured finding deduplication and triage
- [x] 10.7 Unit-test browser unavailable state
- [x] 10.8 Unit-test cloud CLI missing and read-only behavior
- [x] 10.9 Add an end-to-end DVWA test using `http_replay` instead of bash curl

## 11. Verification

- [x] 11.1 Run `node node_modules/typescript/bin/tsc --noEmit -p packages/core`
- [x] 11.2 Run `node node_modules/typescript/bin/tsc --noEmit -p packages/ui-web`
- [x] 11.3 Run available Bun tests for changed packages
- [x] 11.4 Run import and generator scripts if assets change
- [x] 11.5 Run `openspec validate port-cyberstrike-native-tools`
- [x] 11.6 Compare a DVWA task before and after native HTTP tooling to verify fewer bash/curl errors