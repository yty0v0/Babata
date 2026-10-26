## ADDED Requirements

### Requirement: Solver roles are host-owned
The system SHALL assign each solver instance a role such as planner, executor, observer, or reviewer from trusted host configuration, and MUST NOT trust role, principal id, source, or capability fields supplied by a model request.

#### Scenario: Model attempts to escalate role
- **WHEN** a model sends a Host Bridge request containing `role`, `principal_id`, or `source`
- **THEN** those fields are ignored and authorization uses only the host-owned solver identity

#### Scenario: Solver has no role
- **WHEN** a solver without an assigned role calls a Taric operation
- **THEN** the request is rejected with `authorization_error`

### Requirement: Host Bridge actions are role-scoped
The system SHALL enforce an action allowlist per solver role and SHALL reject actions outside that role's allowlist with a consistent authorization error.

#### Scenario: Planner calls executor-only action
- **WHEN** a planner solver requests an executor-only action
- **THEN** the request is rejected and no state change occurs

#### Scenario: Observer calls host-only operation
- **WHEN** an observer solver requests a host-only Taric operation
- **THEN** the request is rejected and no authority write occurs

### Requirement: Host Bridge requests are audited
The system SHALL record every Host Bridge request and response in an append-only audit log with request id, solver id, role, action, challenge id, engagement id, outcome, error code, and timestamp.

#### Scenario: Successful request is audited
- **WHEN** an authorized Host Bridge request succeeds
- **THEN** the audit log contains one completed request record with the actual host-owned role and outcome

#### Scenario: Rejected request is audited
- **WHEN** a Host Bridge request is rejected
- **THEN** the audit log contains the rejection and error code without recording untrusted request identity fields as authoritative

### Requirement: Host Bridge requests are bounded
The system SHALL enforce request size limits, per-action rate limits, and timeouts for Host Bridge calls, and SHALL return a consistent error when a request exceeds those bounds.

#### Scenario: Rate limit is exceeded
- **WHEN** a solver exceeds the configured rate limit for an action
- **THEN** subsequent requests are rejected temporarily with a rate-limit error and no handler is invoked

#### Scenario: Request times out
- **WHEN** a Host Bridge handler does not complete within its timeout
- **THEN** the caller receives a timeout error and the request is marked incomplete in the audit log

### Requirement: Challenge and engagement bindings are enforced
The system SHALL bind each Taric-capable challenge to one active engagement and SHALL reject requests whose solver, challenge, and engagement binding do not match.

#### Scenario: Cross-engagement access is attempted
- **WHEN** a solver bound to one challenge attempts to access another engagement
- **THEN** the request is rejected with `authorization_error`

#### Scenario: Binding state is pending
- **WHEN** a challenge has no active engagement binding
- **THEN** Taric operations for that challenge return a degraded configuration error and no cross-challenge fallback occurs
