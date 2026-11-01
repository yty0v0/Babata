## ADDED Requirements

### Requirement: Taric is authoritative for Taric-managed challenge memory
The system SHALL use Taric as the sole persistence authority for memory and idea data belonging to Taric-managed scopes. A typed adapter MAY isolate transport and projection details, but it SHALL NOT select an alternate persistence backend for those scopes. Local JSON compatibility SHALL be restricted to explicitly legacy-local scopes and MUST NOT be used as an outage fallback.

#### Scenario: Taric-managed scope reads authoritative data
- **WHEN** a Taric-managed challenge has a valid host-owned engagement binding
- **THEN** reads use only the Taric authoritative projection scoped to that binding and identify Taric as the source

#### Scenario: Taric is unavailable for a managed scope
- **WHEN** a Taric-managed read cannot reach a healthy authority
- **THEN** the system returns an explicit unavailable/degraded or policy-blocked result and does not read or write local JSON as a substitute

#### Scenario: Explicit legacy scope remains supported
- **WHEN** a challenge is explicitly configured as legacy-local
- **THEN** the documented legacy compatibility path may be used only for that challenge and is not selected for Taric-managed challenges

### Requirement: Provider scope is challenge-isolated
The system SHALL derive scope from host-owned challenge and engagement bindings, not model-controlled request fields.

#### Scenario: Binding is missing
- **WHEN** Taric data is requested for a challenge without a valid active engagement binding
- **THEN** the system returns an explicit configuration/unavailable result and performs no cross-scope or local fallback read

#### Scenario: Caller supplies a mismatched scope
- **WHEN** request data contains an engagement, project, tenant, or challenge scope that conflicts with host-owned binding
- **THEN** the system rejects or ignores the untrusted scope and does not issue a cross-scope request

### Requirement: Reads preserve completeness and provenance
The Taric adapter SHALL communicate source, completeness, and bounded diagnostics, and SHALL NOT convert authorization, consistency, or protocol failures into successful empty authoritative data.

#### Scenario: Taric read is partial
- **WHEN** the underlying Taric read returns partial or degraded data
- **THEN** the adapter preserves that status and stable diagnostics for downstream consumers

#### Scenario: Taric rejects authorization
- **WHEN** the underlying authority rejects access
- **THEN** the adapter returns an explicit authorization/provider error rather than a successful empty result or local fallback

### Requirement: Read adapters do not bypass governance
The read adapter SHALL be read-only and MUST NOT grant model callers authority to create/admit proposals, alter WorkRuns/checkpoints, bind evidence, or bypass report gates.

#### Scenario: Model attempts an authoritative write through a read adapter
- **WHEN** a model-facing caller uses the memory read interface
- **THEN** no Taric or host authority write operation is available through that interface

### Requirement: Project-bound scope requires separately verified identity mapping
The system MUST NOT enable project-bound memory access until a separate trusted mapping and credential/isolation design binds challenges to tenant, project, and engagement identities and is covered by cross-scope security tests.

#### Scenario: Project mode is requested before prerequisites exist
- **WHEN** configuration requests project-bound access without verified mapping and isolation prerequisites
- **THEN** startup or adapter construction fails closed with a clear configuration diagnostic