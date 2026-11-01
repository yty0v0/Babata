# Align observer curation with the reference implementation

## Why
The reference observer maintains a compact, evidence-grounded memory/idea board. A read-only reviewer loses its primary function and encourages repetitive reminders. The current Taric integration must retain its single authority and must not revive solver-local JSON board writes.

## What Changes
- Restore evidence-grounded curation: inspect the board, close existing hypotheses before adding new ones, and prefer NO_CHANGE when nothing durable changed.
- Give only the observer sidecar curation proposal tools. Solver board tools remain read-only.
- Submit all additions, revisions and retirement requests as immutable L0 proposals through the existing host-validated Taric outbox. Revisions do not directly mutate canonical records or mark hypotheses verified.
- Host derives the project title from the bound challenge; model input cannot choose a project or admission state.
- Provide a bounded Taric evidence query to obtain real UUID references; never invent references.
- Keep rare, deduplicated, cooled-down efficiency reminders and accurately report delivery.

## Impact
Observer tools/prompts, Taric proposal handler and runtime wiring, board trust presentation, regression tests. Existing Taric read diagnostics, admission policy and legacy direct-write guards remain intact.
