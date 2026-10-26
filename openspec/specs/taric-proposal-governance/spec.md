# taric-proposal-governance Specification

## Purpose
TBD - created by archiving change integrate-taric-board. Update Purpose after archive.
## Requirements
### Requirement: Models submit typed proposals only
The system SHALL allow model principals to submit only typed `work_item`, `claim`, `checkpoint`, and `correction` proposals, and SHALL reject arbitrary board writes or unsupported proposal kinds.

#### Scenario: Valid work item proposal
- **WHEN** an authorized model submits a schema-valid `work_item` proposal for its engagement
- **THEN** the proposal is recorded as pending L0 and no authoritative state is admitted

#### Scenario: Unsupported proposal kind
- **WHEN** a model submits a proposal with an unsupported kind
- **THEN** the request is rejected with a validation error and no proposal is created

### Requirement: Proposal acceptance is not model-controlled
The system MUST ignore or reject model-supplied admission decisions, trust levels, and reviewer attestations, and SHALL require a separate host or reviewer path for admission.

#### Scenario: Model claims acceptance
- **WHEN** a proposal request contains `accept: true`, `trust_level`, or reviewer attestation
- **THEN** the proposal remains pending L0 and no admission event is generated

### Requirement: Proposal admission defaults to human review
The system SHALL default proposal admission to `hitl_l1`, where a Web UI reviewer action is required before the host invokes Taric admission, and SHALL keep `auto_l1` and `disabled` as explicit configuration modes.

#### Scenario: HITL proposal is not reviewed
- **WHEN** a proposal is pending in `hitl_l1` mode
- **THEN** no authoritative L1 record is created and the proposal remains visible for review

#### Scenario: Reviewer approves proposal
- **WHEN** an authorized reviewer approves a pending proposal in the Web UI
- **THEN** the host invokes Taric admission and records the resulting L0-to-L1 decision and audit event

#### Scenario: Approval is scoped to one proposal
- **WHEN** a reviewer approves a single pending proposal while other proposals are also buffered
- **THEN** only the reviewed proposal is submitted and the other proposals remain pending

### Requirement: Auto-admission is limited to structural proposals
The system SHALL support an `auto_l1` mode that admits only proposals which record work state and SHALL still require human review for proposals that publish authoritative facts.

#### Scenario: Checkpoint is auto-admitted
- **WHEN** `auto_l1` is enabled and a pending checkpoint proposal exists
- **THEN** the host submits and admits it without human review and records `auto-policy` as the reviewer

#### Scenario: Claim still requires review
- **WHEN** `auto_l1` is enabled and a pending claim proposal exists
- **THEN** the claim is not admitted automatically and remains pending for human review

### Requirement: Proposals are buffered idempotently during Taric outages
The system SHALL buffer only `proposal.submit` calls in an outbox when Taric is temporarily unavailable, and SHALL replay them using a stable idempotency key with acknowledgment state.

#### Scenario: Proposal is buffered and replayed
- **WHEN** Taric becomes unavailable after a model submits a valid proposal and later recovers
- **THEN** the outbox replays the proposal exactly once and marks it acknowledged after success

#### Scenario: Idempotency conflict occurs during replay
- **WHEN** replay receives an idempotency conflict for an already accepted proposal
- **THEN** the outbox treats the proposal as successfully submitted and does not create a duplicate

### Requirement: Authoritative host writes fail closed
The system MUST NOT buffer host authoritative writes such as observations, admissions, work state, or checkpoint commits in the proposal outbox; a failed authoritative write SHALL return an error to the caller.

#### Scenario: Host admission fails
- **WHEN** the host attempts an authoritative admission and Taric rejects or is unavailable
- **THEN** the operation fails immediately and is not silently queued for later replay

### Requirement: Proposal governance is auditable
The system SHALL record proposal submission, review decision, admission result, rejection reason, and replay outcome with actor identity and engagement binding.

#### Scenario: Proposal is rejected
- **WHEN** a reviewer rejects a pending proposal
- **THEN** the proposal remains auditable with rejection reason and no authoritative record is admitted

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

