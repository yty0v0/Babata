## ADDED Requirements

### Requirement: Lifecycle proposals are mandatory

When Taric is enabled, the solver lifecycle SHALL use Taric proposals for WorkItem creation, observation, and checkpoint instead of relying on optional tool invocation.

#### Scenario: Solver records a finding
- **WHEN** an executor records a finding
- **THEN** the host creates a corresponding Taric proposal and submits it through admission

#### Scenario: Solver attempts to bypass Taric
- **WHEN** a solver writes state through non-Taric tools while Taric is active
- **THEN** that write is rejected or downgraded to a proposal by the host

### Requirement: Host-derived authority fields cannot be overridden

The proposal normalizer SHALL continue to strip model-supplied authority fields and use only host-derived identities and evidence references.

#### Scenario: Model supplies a reviewer or evidence id
- **WHEN** a model proposal contains `reviewed_by`, `evidence_refs`, or `observation_refs`
- **THEN** those fields are ignored or rejected according to the existing host trust policy
