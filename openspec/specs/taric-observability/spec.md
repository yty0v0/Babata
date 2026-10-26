# taric-observability Specification

## Purpose
TBD - created by archiving change integrate-taric-board. Update Purpose after archive.
## Requirements
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

### Requirement: Evidence coverage is reported

The system SHALL report how many recent checkpoints carry Taric `evidence_refs` and how many were committed with an evidence gap, so the operator can see whether the verifiable-evidence path is working.

#### Scenario: All recent checkpoints carry evidence
- **WHEN** every recent committed checkpoint has at least one `evidence_refs` entry
- **THEN** the integration status reports full evidence coverage

#### Scenario: Evidence gap exists
- **WHEN** a checkpoint was committed without `evidence_refs`
- **THEN** the integration status reports the gap with the WorkRun reference

### Requirement: Repair outcomes are observable

The system SHALL report the number of checkpoints repaired and the number still awaiting repair, together with the last repair error.

#### Scenario: Repair succeeds
- **WHEN** the repair pass closes an admitted checkpoint
- **THEN** the status shows an incremented repaired count

#### Scenario: Repair is stuck
- **WHEN** a checkpoint remains uncommitted after repeated attempts
- **THEN** the status shows it as awaiting repair with the last error

### Requirement: Blackboard state is observable

Taric status SHALL report active WorkItems, checkpoint coverage, evidence coverage, report-gate failures, and recovery state when Taric is enabled.

#### Scenario: A challenge has incomplete checkpoints
- **WHEN** active WorkItems have no current checkpoint
- **THEN** Taric status exposes those WorkItems as lifecycle gaps

#### Scenario: Evidence binding fails
- **WHEN** a checkpoint is committed without evidence
- **THEN** Taric status records an explicit evidence gap

### Requirement: Automatic capture outcomes are observable

Taric status SHALL include the number of tool results captured, skipped, and failed to bind to evidence.

#### Scenario: Tool result capture succeeds
- **WHEN** host captures a tool result into an artifact and observation
- **THEN** the capture counters reflect the success

#### Scenario: Tool result capture fails
- **WHEN** artifact or observation write fails
- **THEN** the failure is visible without blocking the executor unless required by admission

