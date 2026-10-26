## ADDED Requirements

### Requirement: Reports require a Taric checkpoint

When Taric is enabled, the report submission tool SHALL verify that the submitted asset has a current admitted checkpoint before accepting the report.

#### Scenario: Asset has an admitted checkpoint
- **WHEN** a solver submits a report for an asset with a current checkpoint
- **THEN** the report is accepted through the normal submission path

#### Scenario: Asset has no checkpoint
- **WHEN** a solver submits a report for an asset without a checkpoint
- **THEN** the report is rejected with a lifecycle-gate error

### Requirement: Reports require evidence or an explicit gap

The report gate SHALL require the checkpoint to reference admitted evidence, or an explicit host-recorded evidence gap.

#### Scenario: Checkpoint has evidence refs
- **WHEN** the report references a checkpoint with evidence refs
- **THEN** the report gate passes the evidence requirement

#### Scenario: Checkpoint has no evidence and no gap
- **WHEN** the report references a checkpoint without evidence refs and without an evidence gap
- **THEN** the report is rejected and the gap is surfaced in Taric status

### Requirement: Report gate failures are observable

The host SHALL record report-gate failures with the asset, solver, checkpoint, and missing requirement.

#### Scenario: Report is rejected
- **WHEN** the Taric report gate rejects a submission
- **THEN** the failure appears in Taric observability and in the solver-facing error response
