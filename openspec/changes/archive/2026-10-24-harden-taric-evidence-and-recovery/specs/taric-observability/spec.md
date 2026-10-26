## ADDED Requirements

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
