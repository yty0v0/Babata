# taric-work-recovery Specification

## Purpose
TBD - created by archiving change integrate-taric-board. Update Purpose after archive.
## Requirements
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

### Requirement: Checkpoint authority is re-derived at submission time
The system SHALL renew an active lease before it expires while the host is driving the work, and SHALL re-derive checkpoint authority from the live WorkRun immediately before a buffered proposal is submitted, so that human review latency cannot invalidate a queued checkpoint.

#### Scenario: Review outlives the original lease
- **WHEN** a reviewer approves a pending checkpoint after the lease captured at enqueue time has already expired
- **THEN** the host renews the WorkRun, submits the checkpoint with the current lease, attempt, generation, and read sequence, and admission succeeds

#### Scenario: Already-submitted proposal is stale
- **WHEN** a checkpoint was already submitted to Taric under a lease that has since changed or expired
- **THEN** approval fails with `stale_version` and operator guidance to submit a fresh checkpoint, and no admission is attempted

#### Scenario: Idle work runs are not renewed
- **WHEN** no solver is running and no proposal is awaiting review for a WorkRun
- **THEN** the host stops renewing its lease so the run can expire and be reclaimed

### Requirement: Admitted checkpoints close the WorkRun
The host SHALL commit a checkpoint after its proposal is admitted, because model principals cannot call `checkpoint.commit`, and SHALL persist the returned checkpoint id on the WorkRun.

#### Scenario: Checkpoint proposal is approved
- **WHEN** a reviewer approves a pending checkpoint proposal
- **THEN** the host commits the checkpoint with current WorkRun authority and the local WorkRun becomes `checkpointed` with a non-empty checkpoint id

#### Scenario: Admission callback is retried
- **WHEN** the same admitted checkpoint is observed again
- **THEN** the host treats the existing committed checkpoint as idempotent and does not commit a duplicate

### Requirement: The host reconciles derived projections
The host SHALL reconcile the Taric authority outbox after checkpoint admission and while active engagements exist, because Taric runs as one-shot containers without a resident outbox consumer.

#### Scenario: Outbox has pending projections
- **WHEN** `audit.reconcile` preview reports pending outbox entries
- **THEN** the host replays them once and records the resulting committed and projected sequence numbers

#### Scenario: Outbox is already drained
- **WHEN** the preview reports no pending outbox entries
- **THEN** the host does not replay and the read projection is already current

### Requirement: Expired work runs resume in a replacement solver
The host SHALL reclaim only WorkRuns whose lease has expired and that carry a checkpoint, SHALL transfer WorkRun ownership to the replacement solver's principal, and SHALL inject the recovered checkpoint into the new solver task.

#### Scenario: Solver crashes after checkpointing
- **WHEN** a replacement solver starts for a challenge whose previous WorkRun lease expired and whose checkpoint was committed
- **THEN** the host reclaims that run, resumes it, and gives the new solver the completed steps, next steps, facts, and open questions

#### Scenario: Resume premises changed
- **WHEN** Taric reports `replan_required` after a reclaimed attempt
- **THEN** the host keeps the run active and instructs the solver to re-verify the recorded facts and replan before continuing

#### Scenario: Live lease is not stolen
- **WHEN** a WorkRun lease is still active
- **THEN** the host does not select it for recovery and launches new work instead

### Requirement: Crashed runs are held until they can be reclaimed
The host SHALL refuse to claim a new WorkRun for a challenge while an unexpired run owned by a dead solver is still awaiting reclamation, and MUST NOT degrade that refusal into an untracked solver launch.

#### Scenario: Solver crashes before lease expiry
- **WHEN** a solver dies while its WorkRun lease is still valid
- **THEN** the host rejects new launches for that challenge with an explicit recovery-pending reason until the lease expires

#### Scenario: Refusal is not swallowed
- **WHEN** the host bridge treats Taric failures as advisory
- **THEN** the recovery-pending refusal still aborts the launch instead of starting a solver without a WorkRun

#### Scenario: Expired run is reclaimed automatically
- **WHEN** the lease finally expires and the planner retries the launch
- **THEN** the host reclaims the existing run, resumes its checkpoint, and records the new generation

### Requirement: Artifacts back checkpoints with verifiable hashes
The system SHALL persist captured tool results as Taric artifacts and SHALL attach their hashes to the admitted checkpoint, so evidence is verifiable instead of being free text.

#### Scenario: Tool output is captured
- **WHEN** a solver produces tool output above the trivial-size threshold
- **THEN** the host stores it as a committed artifact and records the producing attempt and WorkRun

#### Scenario: Checkpoint is committed
- **WHEN** the host commits an admitted checkpoint
- **THEN** it attaches only committed artifacts from the same WorkRun and attempt, with content hashes

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

