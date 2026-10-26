## ADDED Requirements

### Requirement: WorkItems are the recovery unit

When Taric is enabled, executor recovery SHALL resume from the latest admitted checkpoint of its WorkItem instead of rebuilding state from challenge JSON or model memory.

#### Scenario: Solver crashes after checkpoint
- **WHEN** a solver with an admitted checkpoint is reclaimed
- **THEN** the replacement solver receives the checkpoint delta and current WorkItem state

#### Scenario: Solver crashes before any checkpoint
- **WHEN** a solver is reclaimed without an admitted checkpoint
- **THEN** the WorkItem returns to a requeued state with no fabricated evidence

### Requirement: Blackboard recovery is observable

The host SHALL report WorkItems awaiting repair, recovered WorkItems, and stale-write rejections in Taric status.

#### Scenario: Recovery repairs a WorkItem
- **WHEN** the maintenance pass closes an admitted checkpoint
- **THEN** the recovery counters and WorkItem status reflect the repair
