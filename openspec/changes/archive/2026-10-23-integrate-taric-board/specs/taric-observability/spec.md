## ADDED Requirements

### Requirement: Host state is polled with backoff
The system SHALL poll Taric host state through a trusted host principal using bounded requests and retry backoff, and SHALL not block the BreachWeave UI on a single slow Taric call.

#### Scenario: Taric responds slowly
- **WHEN** a host-state call exceeds its timeout budget
- **THEN** the polling loop aborts the request, records degraded status, and the UI remains responsive

#### Scenario: Taric recovers
- **WHEN** a previously unavailable Taric sidecar responds successfully
- **THEN** host-state polling resumes without requiring a BreachWeave restart

### Requirement: Runtime health is continuously verifiable
The system SHALL expose Taric health, engagement binding status, authority diagnostics, sidecar status, and audit doctor results to the host operator.

#### Scenario: Doctor reports drift
- **WHEN** Taric `audit.doctor` reports authority or content drift
- **THEN** the operator-facing status shows the failure and integration remains degraded rather than silently continuing

#### Scenario: All health checks pass
- **WHEN** the Taric container, sidecar, authority, and binding are healthy
- **THEN** the operator-facing status reports the integration as ready

### Requirement: Integration behavior is regression-testable
The system SHALL include automated regression coverage for authorization boundaries, response envelope handling, degraded mode, outbox replay, work recovery, artifact access, coverage projection, and rollback.

#### Scenario: Taric is disabled in regression test
- **WHEN** the test suite runs with `tch.taric.enabled=false`
- **THEN** existing challenge and memory behavior remains functional and no Taric tool is registered

#### Scenario: Outer success masks inner failure
- **WHEN** a Taric response has outer `ok:true` but inner `data.ok:false`
- **THEN** the integration treats the business operation as failed and records the inner error

### Requirement: Audit and diagnostics preserve actor provenance
The system SHALL record operator, host, reviewer, and model actions with host-derived actor identity, scope, operation, and outcome in audit logs.

#### Scenario: Operator performs maintenance
- **WHEN** an operator runs audit doctor or reconcile
- **THEN** the audit record identifies the operator principal and affected engagement without trusting request-supplied identity
