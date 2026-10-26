## ADDED Requirements

### Requirement: Work is claimed through governed leases
The system SHALL create and claim WorkRuns only through the host using Taric work operations, and SHALL prevent two active attempts from owning the same WorkItem generation.

#### Scenario: Executors claim different work
- **WHEN** two executors claim different eligible work items
- **THEN** both receive independent WorkRuns and neither can write the other's checkpoint state

#### Scenario: Duplicate claim is rejected
- **WHEN** an executor attempts to claim a WorkItem already owned by an active lease
- **THEN** the claim is rejected or blocked and no second active owner is created

### Requirement: Stale attempts cannot overwrite current state
The system SHALL bind solver writes to WorkRun, attempt, generation, and read sequence, and SHALL reject writes from stale or reclaimed attempts with a version or stale-state error.

#### Scenario: Old attempt writes after reclaim
- **WHEN** a reclaimed attempt submits a checkpoint after a new attempt owns the work
- **THEN** the write is rejected as stale and the current attempt state remains unchanged

### Requirement: Checkpoints support bounded recovery
The system SHALL require checkpoints to include next steps, facts used, open questions, and host-supplied run metadata, and SHALL allow a resumed attempt to continue or return a replan/blocked result when premises changed.

#### Scenario: Solver resumes after crash
- **WHEN** a new attempt resumes a WorkRun with a valid checkpoint
- **THEN** it receives the checkpoint and can continue from the recorded next steps when scope and work premises are unchanged

#### Scenario: Work premises changed
- **WHEN** a resumed WorkRun detects changed scope or WorkItem state
- **THEN** the result is `replan_required` or `blocked` instead of silently continuing with stale premises

### Requirement: Lease renewal and reclaim are host-controlled
The system SHALL let the host renew, reclaim, and resume WorkRuns based on solver lifecycle and lease policy, and MUST NOT expose those operations directly to model principals.

#### Scenario: Executor lease expires
- **WHEN** a solver lease expires before completion
- **THEN** the host can reclaim the WorkRun and preserve the old attempt as historical state

#### Scenario: Model requests reclaim
- **WHEN** a model principal attempts a work reclaim operation
- **THEN** the request is rejected with `authorization_error`
