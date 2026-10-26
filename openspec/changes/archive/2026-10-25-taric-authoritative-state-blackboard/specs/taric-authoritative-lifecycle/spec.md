## ADDED Requirements

### Requirement: Solver starts from an injected Taric context pack

The host SHALL read the latest Taric context pack for the solver role and SHALL append it to the solver system prompt when a Taric binding is active.

#### Scenario: Taric binding is active at solver start
- **WHEN** a solver session is constructed for a challenge with an active Taric binding
- **THEN** the system prompt contains the latest admitted Taric context for that solver role

#### Scenario: Taric binding is absent
- **WHEN** no active Taric binding exists for the challenge
- **THEN** the legacy challenge prompt path remains unchanged

### Requirement: Executor work is represented by a Taric WorkItem

The host SHALL ensure each active executor has a Taric WorkItem for its assigned asset or task before execution work is accepted.

#### Scenario: Executor starts a new assignment
- **WHEN** the host launches an executor for a challenge asset
- **THEN** a host-owned WorkItem claim or proposal is created for that assignment

#### Scenario: WorkItem cannot be created
- **WHEN** Taric rejects WorkItem creation
- **THEN** the executor startup fails closed and the error is surfaced instead of running outside the blackboard

### Requirement: Checkpoint boundaries are enforced

The host SHALL require a checkpoint at executor startup, after a report-worthy finding, and before executor completion when Taric is enabled.

#### Scenario: Executor reports a finding
- **WHEN** a solver records a finding in a Taric-enabled challenge
- **THEN** the host commits or queues a checkpoint for the corresponding WorkItem

#### Scenario: Executor attempts to finish without checkpoint
- **WHEN** a Taric-enabled solver reaches completion without a current checkpoint
- **THEN** the host rejects normal completion and records a lifecycle gap

### Requirement: Model memory and idea writes are not authoritative

When Taric is enabled, the model-facing memory and idea tools SHALL be read-only or host-maintained projections, and SHALL NOT be the authoritative source of executor state.

#### Scenario: Model attempts direct memory write
- **WHEN** a solver tries to create or update memory while Taric is active
- **THEN** the tool either rejects the write or routes it through host-controlled Taric observation admission

#### Scenario: UI reads memory state
- **WHEN** the UI requests solver memory in a Taric-enabled challenge
- **THEN** the returned state is derived from Taric-admitted records rather than model-written files
