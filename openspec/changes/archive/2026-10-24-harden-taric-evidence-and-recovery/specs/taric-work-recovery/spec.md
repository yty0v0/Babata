## ADDED Requirements

### Requirement: Admitted checkpoints are repaired automatically

The host SHALL periodically detect checkpoints that were admitted but never committed to their WorkRun, and SHALL retry the idempotent commit without requiring human re-approval.

#### Scenario: Commit fails after admission
- **WHEN** an admitted checkpoint proposal exists and its WorkRun is still not `checkpointed`
- **THEN** the repair pass retries the commit and the WorkRun becomes `checkpointed` with a checkpoint id

#### Scenario: WorkRun is already closed
- **WHEN** the repair pass inspects a WorkRun that is already `checkpointed`
- **THEN** it skips the run without issuing another commit

#### Scenario: Repair fails repeatedly
- **WHEN** the commit keeps failing for the same WorkRun
- **THEN** the failure is recorded on the WorkRun and surfaced in status rather than retried without bound

### Requirement: Lease duration is deployment-configurable

The host SHALL read the WorkRun lease duration from configuration and SHALL clamp it to a safe range, so recovery timing can be tuned without changing solver behavior.

#### Scenario: Operator sets a short lease
- **WHEN** the configured lease is shorter than the minimum
- **THEN** the host clamps it to the minimum and records the effective value

#### Scenario: Lease is not configured
- **WHEN** no lease override is configured
- **THEN** the host uses the default five-minute lease
