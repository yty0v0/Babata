## ADDED Requirements

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
