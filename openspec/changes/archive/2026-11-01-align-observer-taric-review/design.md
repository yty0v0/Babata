# Design

## Reference contract
Observer curates durable facts and scoped negative results and maintains ideas from solver observations. Solver executes and validates. Order: no change, revise existing knowledge, retire superseded entries, add genuinely new knowledge. A single payload failure does not invalidate an entire route. History queries are on demand; reminders are a last resort.

## Authority and persistence
Curation tools use taric_proposal_submit with a typed observer_board_change envelope. The host validates board/operation/content/status/UUID evidence and target references, resolves project identity from challenge state, normalizes a fresh claim proposal, and stamps the familiar project memory/idea title. Existing durable outbox, deduplication and Taric admission remain the persistence path. No solver board-store mutators or direct challenge_memory_add/challenge_idea_add are called.

Add/update/retire are intentions, not canonical writes. An update or retirement is an immutable replacement/retirement candidate that names the original record, evidence, scope and limitation. Candidate admission alone does not silently rewrite or delete its target. Requested idea status is an observation for review; canonical status changes remain Taric-governed. UI/tool output must say proposed/pending, never saved/verified/deleted. The model cannot set trust, version, engagement, project identity or authoritative fields.

## Read and failure behavior
Read the current board before proposing changes. Preserve partial/failed read diagnostics. When evidence IDs are absent, use the host-scoped bounded Taric read query; do not fabricate them. Missing binding, disabled submission, failed host delivery or failed Taric dispatch never fall back to local JSON. Missing reminder callback means not delivered.

## Compatibility
Keep familiar memory_add/memory_update/memory_delete/idea_add/idea_update tool names on the observer only, but describe each as a proposal. Keep the solver toolset read-only. Show trust on board rows and document unresolved target changes.

## Validation
Run focused Bun tests, proposal/schema/outbox/provider and observer-loop regressions, core typecheck and OpenSpec strict validation. Copy only changed files into the D: checkout and place temporary files and caches there. Do not run tests or download dependencies on C:.
