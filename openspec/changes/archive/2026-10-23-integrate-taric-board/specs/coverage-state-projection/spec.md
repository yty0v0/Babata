## ADDED Requirements

### Requirement: Asset coverage uses five states
The system SHALL represent asset coverage with `untested`, `blocked`, `negative`, `positive`, and `unknown` states, including a reason and Taric reference where applicable.

#### Scenario: Blocked asset is recorded
- **WHEN** testing an asset is blocked by scope, credentials, or environment
- **THEN** its coverage state is `blocked` with a human- or system-readable reason

#### Scenario: Test is negative
- **WHEN** a required test completes without a positive finding
- **THEN** the asset can be represented as `negative` rather than merely scanned

### Requirement: Legacy scanned field is a compatible projection
The system SHALL retain the existing `scanned` boolean as a compatibility projection and MUST NOT use both `scanned` and coverage state as independent completion authorities.

#### Scenario: Coverage maps to legacy projection
- **WHEN** a challenge asset has `coverage_state: positive` or `negative`
- **THEN** its `scanned` projection is `true`

#### Scenario: Legacy field is consumed
- **WHEN** existing code reads the legacy `scanned` field
- **THEN** the value remains consistent with the authoritative coverage state projection

### Requirement: Completion uses one coverage authority
The system SHALL use the governed coverage state as the sole completion authority after migration and SHALL surface ambiguous or blocked assets as incomplete when required by challenge policy.

#### Scenario: Completion is evaluated
- **WHEN** challenge completion is computed
- **THEN** it uses coverage state semantics rather than independently recomputing completion from `scanned`

#### Scenario: Coverage state is unknown
- **WHEN** an asset has `coverage_state: unknown`
- **THEN** challenge completion treats it as not conclusively tested according to policy

### Requirement: Coverage changes are projected from Taric
The system SHALL synchronize governed coverage updates from Taric into the existing challenge JSON projection and SHALL preserve a reference to the governing Taric record.

#### Scenario: Coverage proposal is admitted
- **WHEN** a governed coverage update becomes authoritative
- **THEN** the challenge projection updates its coverage fields and retains the Taric record reference

#### Scenario: Projection is rebuilt
- **WHEN** the JSON projection is rebuilt from Taric
- **THEN** coverage fields and legacy `scanned` values are reconstructed consistently
