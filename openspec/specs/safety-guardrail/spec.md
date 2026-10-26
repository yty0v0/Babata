# safety-guardrail Specification

## Purpose
TBD - created by archiving change add-pluggable-safety-guardrail. Update Purpose after archive.
## Requirements
### Requirement: Guardrail activation is configurable

The system SHALL store a host-level guardrail configuration with an enabled flag, a mode, and independent rule switches. The configuration SHALL be editable from the Config UI and SHALL apply to newly created solver and subagent sessions.

#### Scenario: Guardrail is disabled
- **WHEN** the operator disables the guardrail
- **THEN** solver and subagent sessions are created without the guardrail extension and existing tool behavior is unchanged

#### Scenario: Guardrail is enabled in observe mode
- **WHEN** the operator enables the guardrail with mode `observe`
- **THEN** every evaluated tool call is recorded and allowed to continue unless an existing independent guard rejects it

#### Scenario: Guardrail is enabled in enforce mode
- **WHEN** the operator enables the guardrail with mode `enforce`
- **THEN** a tool call that violates an enabled rule is blocked before execution and the model receives the blocking reason

### Requirement: Guardrail evaluates before tool execution

The system SHALL inspect model-callable tool traffic before tool execution. The guardrail SHALL be registered before other execution-affecting extensions when enabled.

#### Scenario: Solver session starts with guardrail enabled
- **WHEN** a solver session is created and the guardrail is enabled
- **THEN** the guardrail extension observes each tool call before the tool executes

#### Scenario: Subagent session starts with guardrail enabled
- **WHEN** a subagent session is created and the guardrail is enabled
- **THEN** the guardrail extension observes the subagent tool calls before execution

### Requirement: Bash commands are safety-checked

The system SHALL evaluate bash commands for forbidden tools, dangerous writes, reverse shells, sensitive paths, indirect script bodies, and out-of-scope network targets when the corresponding rules are enabled.

#### Scenario: Dangerous write is attempted
- **WHEN** the model invokes bash with an enabled dangerous-write rule and a destructive command is detected
- **THEN** enforce mode blocks the command and observe mode records the decision without executing

#### Scenario: Reverse shell is attempted
- **WHEN** the model invokes bash with an enabled reverse-shell rule and a reverse or bind shell shape is detected
- **THEN** the command is handled according to the active mode and is blocked in enforce mode

#### Scenario: Command runs an indirect script
- **WHEN** a bash command executes a script file
- **THEN** the system evaluates the script body before allowing execution

### Requirement: File reads are allowed and mutations are bounded

The system SHALL allow read-only access to sensitive paths and SHALL reject file mutations outside the task workspace or inside configured sensitive roots.

#### Scenario: Sensitive file is read
- **WHEN** the model reads a configured sensitive path
- **THEN** the read is allowed in both observe and enforce modes

#### Scenario: Write escapes the workspace
- **WHEN** the model attempts to write or edit outside the task workspace
- **THEN** the file mutation is blocked in enforce mode and recorded in observe mode

#### Scenario: Sensitive file is mutated
- **WHEN** the model attempts to write, edit, or delete a configured sensitive path
- **THEN** enforce mode blocks the mutation and observe mode records the decision

### Requirement: Network tool traffic passes through the guardrail

The system SHALL route native network-capable tools through the shared guardrail target checker before any request is sent. This requirement applies to HTTP replay, raw HTTP replay, CSRF extraction, attack-script network operations, browser navigation, and native runtime network actions.

#### Scenario: Native tool targets an out-of-scope URL
- **WHEN** a native network tool is called with an out-of-scope target
- **THEN** the guardrail rejects the request before network I/O occurs

#### Scenario: Native tool targets an in-scope URL
- **WHEN** a native network tool is called with an in-scope target
- **THEN** the request is allowed and evaluated according to the active mode

### Requirement: Guardrail decisions are audited

The system SHALL append each guardrail decision to an audit log with timestamp, session context, tool name, rule identifier, decision, and reason.

#### Scenario: A violation is recorded
- **WHEN** the guardrail evaluates a tool call and determines it violates an enabled rule
- **THEN** the audit log contains the rule identifier, decision, and reason

#### Scenario: Audit logging fails
- **WHEN** writing the audit log fails
- **THEN** the guardrail SHALL continue evaluating subsequent tool calls without crashing the agent

### Requirement: Guardrail audit records are viewable after a test

The system SHALL expose guardrail audit records for completed and active solver runs through the challenge and runtime detail APIs. The UI SHALL present observed and blocked events with the affected solver, tool, rule, decision, reason, and timestamp.

#### Scenario: Challenge has guardrail audit records
- **WHEN** an operator opens the Guardrail Audit view for a challenge
- **THEN** the UI lists every observed or blocked guardrail event from the challenge's solver workspaces

#### Scenario: Challenge has no guardrail audit records
- **WHEN** an operator opens the Guardrail Audit view and no events exist
- **THEN** the UI shows an explicit empty state without treating it as an error

#### Scenario: Solver audit records are available after the solver stops
- **WHEN** a solver has stopped after recording guardrail events
- **THEN** its stored audit records remain readable from the challenge and runtime detail APIs

### Requirement: Guardrail lifecycle supports observation before enforcement

The system SHALL support an observation phase and an enforcement phase. During observation the guardrail records would-block events without changing execution. During enforcement the guardrail blocks violating tool calls and continues to record them.

#### Scenario: Observation phase is active
- **WHEN** the guardrail is enabled in the observation phase
- **THEN** violating tool calls are recorded as observed and are allowed to continue

#### Scenario: Enforcement phase is active
- **WHEN** the guardrail is enabled in the enforcement phase
- **THEN** violating tool calls are blocked and recorded as blocked

#### Scenario: Observation results are promoted to enforcement
- **WHEN** an operator changes the guardrail phase from observation to enforcement
- **THEN** newly created solver and subagent sessions use enforcement without requiring a code change

### Requirement: Disabled guardrail is behavior-neutral

The system SHALL preserve existing scope and tool behavior when the guardrail is disabled.

#### Scenario: Existing scope checks still apply
- **WHEN** the guardrail is disabled but an existing run-policy or tool-level scope check applies
- **THEN** that existing check continues to operate independently

