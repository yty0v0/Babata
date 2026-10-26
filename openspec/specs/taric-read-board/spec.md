# taric-read-board Specification

## Purpose
TBD - created by archiving change integrate-taric-board. Update Purpose after archive.
## Requirements
### Requirement: Models can query only scoped board data
The system SHALL expose read-only Taric board tools that return only data authorized for the caller’s engagement and role, and MUST NOT expose authority writes, admission, work, host-state, or artifact management operations to model principals.

#### Scenario: Planner reads scoped context
- **WHEN** a planner requests a board query for its bound challenge
- **THEN** the system returns a Context Pack containing only allowed resources, claims, evidence references, and constraints for that engagement

#### Scenario: Model requests a forbidden operation
- **WHEN** a model calls a tool that maps to `capture`, `admission`, `work`, or artifact management
- **THEN** the request is rejected with `authorization_error` and no authority state changes

### Requirement: Read tools return governed visibility
The system SHALL exclude unadmitted L0 candidates from ordinary authoritative recall and SHALL mark admitted candidates with their trust level and provenance rather than presenting them as verified findings.

#### Scenario: Ordinary recall excludes pending proposal
- **WHEN** a query returns authoritative shared memory
- **THEN** pending L0 proposals are not included as authoritative facts

#### Scenario: Admitted candidate is labeled
- **WHEN** an admitted L1 claim is returned
- **THEN** the result includes its trust level and evidence references and does not claim L2 verification status

#### Scenario: Admitted checkpoint is visible by default
- **WHEN** a solver runs an ordinary board query without visibility flags
- **THEN** admitted L1 checkpoints and claims from its engagement are included, while unadmitted L0 candidates remain hidden

### Requirement: Evidence queries return references only
The system SHALL return evidence metadata, hashes, references, and bounded summaries to models, and MUST NOT include opaque artifact bytes or unredacted raw tool output in model views.

#### Scenario: Evidence is queried
- **WHEN** a model requests evidence details
- **THEN** the response contains an evidence reference and bounded metadata without raw payload bytes

### Requirement: Read failures degrade without breaking existing work
The system SHALL return an explicit degraded marker when Taric is unavailable, disabled, or not yet bound to a challenge, and SHALL allow existing BreachWeave challenge workflows to continue without throwing unhandled server errors.

#### Scenario: Taric is stopped
- **WHEN** a model invokes a read-board tool while the Taric container is stopped
- **THEN** the tool returns a bounded degraded response and the existing challenge workflow remains usable

#### Scenario: Engagement binding is absent
- **WHEN** a challenge has no active Taric engagement
- **THEN** read tools return a configuration or binding marker instead of data from another challenge
