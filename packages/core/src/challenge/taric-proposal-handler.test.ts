import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HostBridgeError } from "./host-bridge-types"
import { createTaricProposalHandler } from "./taric-proposal-handler"
import { TaricBindingRegistry, type TaricBindingScopeSnapshot } from "./taric-binding-registry"
import { TaricProposalOutbox } from "./taric-proposal-outbox"
import { TaricWorkManager } from "./taric-work-manager"
import type { HostBridgeHandleContext } from "../runtime/types"

const scope: TaricBindingScopeSnapshot = {
    allowed_targets: ["https://example.test"],
    excluded_targets: [],
    rules_of_engagement_ref: "roe:web-001",
}
const tempDirs: string[] = []

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()
        if (!dir) continue
        await rm(dir, { recursive: true, force: true })
    }
})

async function createBindingRegistry(): Promise<TaricBindingRegistry> {
    const dir = await mkdtemp(join(tmpdir(), "taric-proposal-binding-"))
    tempDirs.push(dir)
    const registry = new TaricBindingRegistry(dir)
    await registry.createPending({ challengeId: "web-001", scope })
    await registry.activate({ challengeId: "web-001", engagementId: "engagement-1", engagementRecordId: "record-1" })
    return registry
}

async function createOutbox(): Promise<TaricProposalOutbox> {
    const dir = await mkdtemp(join(tmpdir(), "taric-proposal-handler-outbox-"))
    tempDirs.push(dir)
    return new TaricProposalOutbox({ rootDir: dir })
}

function createContext(params: unknown): HostBridgeHandleContext {
    return {
        solverId: "solver-a",
        action: "taric_proposal_submit",
        params,
        getSolverEnvValue: (key: string) => (key === "TCH_CHALLENGE_ID" ? "web-001" : undefined),
        getSolver: () => ({
            id: "solver-a",
            containerId: "container-a",
            name: "container-a",
            promptName: "prompt-a",
            role: "executor",
            task: "",
            challengeId: "web-001",
            status: "running",
            createdAt: 0,
        }),
    }
}

function createContextWithWork(params: unknown, workRunId: string, generation: number): HostBridgeHandleContext {
    return {
        ...createContext(params),
        getWorkState: () => ({ workRunId, attemptId: "attempt-a", generation, readSeq: 9, leaseState: "active" }),
    }
}

const claimParams = {
    kind: "claim",
    expected_version: 0,
    trust_level: "L2",
    content: {
        proposition: "/admin is reachable",
        evidence_refs: ["5eee9386-a285-70b9-8ce5-995fafcc348c"],
        limitations: ["single identity"],
    },
}

describe("Taric proposal handler", () => {
    test("stores model proposal as pending L0 and ignores model trust level", async () => {
        const bindingRegistry = await createBindingRegistry()
        const outbox = await createOutbox()
        const handler = createTaricProposalHandler({ settings: { enabled: true, outbox } , bindingRegistry})
        const result = await handler.handle(createContext(claimParams))
        expect(result.handled).toBe(true)
        expect(result.data).toMatchObject({ status: "pending", trust_level: "L0" })
        const entry = (await outbox.list())[0]
        expect(entry).toMatchObject({
            challenge_id: "web-001",
            engagement_id: "engagement-1",
            solver_id: "solver-a",
            role: "executor",
        })
        expect(entry?.proposal.content).toMatchObject({ kind: "claim" })
        expect("trust_level" in (entry?.proposal ?? {})).toBe(false)
    })

    test("reuses an idempotency key for an identical pending proposal", async () => {
        const bindingRegistry = await createBindingRegistry()
        const outbox = await createOutbox()
        const handler = createTaricProposalHandler({ settings: { enabled: true, outbox }, bindingRegistry })
        const first = await handler.handle(createContext(claimParams))
        const second = await handler.handle(createContext(claimParams))
        expect((first.data as { proposal_id: string }).proposal_id).toBe((second.data as { proposal_id: string }).proposal_id)
        expect(await outbox.list()).toHaveLength(1)
    })

    test("returns degraded when disabled or challenge binding is missing", async () => {
        const bindingRegistry = await createBindingRegistry()
        const outbox = await createOutbox()
        const disabledHandler = createTaricProposalHandler({ settings: { enabled: false, outbox }, bindingRegistry })
        const disabled = await disabledHandler.handle(createContext(claimParams))
        expect(disabled).toMatchObject({ handled: true, data: { degraded: true, reason: "taric_proposal_disabled" } })

        const unboundHandler = createTaricProposalHandler({
            settings: { enabled: true, outbox: await createOutbox() },
            bindingRegistry: new TaricBindingRegistry(),
        })
        const unbound = await unboundHandler.handle(createContext(claimParams))
        expect(unbound).toMatchObject({ handled: true, data: { degraded: true, reason: "challenge_taric_binding_unavailable" } })
    })

    test("replays only through the host-provided dispatcher and acknowledges idempotency conflict", async () => {
        const bindingRegistry = await createBindingRegistry()
        const outbox = await createOutbox()
        const dispatcher = mock(async () => ({ ok: false, error: { code: "idempotency_conflict", message: "already submitted" } }))
        const handler = createTaricProposalHandler({ settings: { enabled: true, autoAcknowledge: true, outbox, dispatcher }, bindingRegistry })
        const result = await handler.handle(createContext(claimParams))
        expect(result.data).toMatchObject({ status: "acknowledged", replay: { applied: 1 } })
        expect(await outbox.list()).toHaveLength(1)
        expect((await outbox.list())[0]?.status).toBe("acknowledged")
    })

    test("rejects invalid proposals as validation errors", async () => {
        const bindingRegistry = await createBindingRegistry()
        const handler = createTaricProposalHandler({
            settings: { enabled: true, outbox: await createOutbox() },
            bindingRegistry,
        })
        let caught: unknown
        try {
            await handler.handle(createContext({ kind: "finding", expected_version: 0, content: {} }))
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(HostBridgeError)
        expect((caught as HostBridgeError).code).toBe("validation_error")
    })

    test("fills checkpoint authority from the host work run and ignores model ownership", async () => {
        const bindingRegistry = await createBindingRegistry()
        const outbox = await createOutbox()
        const dir = await mkdtemp(join(tmpdir(), "taric-proposal-work-"))
        tempDirs.push(dir)
        const dispatcher = mock(async () => ({ ok: true, data: {} }))
        const workManager = new TaricWorkManager({ rootDir: dir, dispatcher })
        const claimed = await workManager.claim({
            challengeId: "web-001",
            engagementId: "engagement-1",
            workItemId: "3e8a43c3-76d2-7070-9185-7b83cae723cd",
            solverId: "solver-a",
            role: "executor",
        })
        const handler = createTaricProposalHandler({ settings: { enabled: true, outbox }, bindingRegistry, workManager })
        await handler.handle(
            createContextWithWork(
                {
                    kind: "checkpoint",
                    expected_version: 0,
                    content: {
                        owner: "forged-owner",
                        generation: 99,
                        completed_steps: ["login"],
                        next_steps: ["verify sqli"],
                        facts_used: ["admin page reachable"],
                        open_questions: ["is CSRF required?"],
                    },
                },
                claimed.work_run_id,
                claimed.generation,
            ),
        )
        const entry = (await outbox.list())[0]
        expect(entry?.proposal.content).toMatchObject({
            work_item_ref: "3e8a43c3-76d2-7070-9185-7b83cae723cd",
            work_run_ref: claimed.work_run_id,
            attempt_ref: claimed.attempt_id,
            generation: claimed.generation,
            owner: { host_id: "breachweave-host", agent_id: "executor-solver-a" },
            next_steps: ["verify sqli"],
            unresolved_work: ["is CSRF required?"],
        })
    })

    test("rejects checkpoint proposals without a host work run", async () => {
        const bindingRegistry = await createBindingRegistry()
        const handler = createTaricProposalHandler({ settings: { enabled: true, outbox: await createOutbox() }, bindingRegistry })
        await expect(
            handler.handle(
                createContext({
                    kind: "checkpoint",
                    expected_version: 0,
                    content: { completed_steps: ["x"], next_steps: ["y"] },
                }),
            ),
        ).rejects.toBeInstanceOf(HostBridgeError)
    })
    test("observer curation is host-scoped and deduplicated in the existing outbox", async () => {
        const bindingRegistry = await createBindingRegistry()
        const outbox = await createOutbox()
        const getBoardProjectKey = mock(async (_challengeId: string) => "host-project-a")
        const handler = createTaricProposalHandler({ settings: { enabled: true, outbox }, bindingRegistry, getBoardProjectKey })
        const params = { observer_board_change: { board: "memory", operation: "add", memory_kind: "failure", content: "The tested anonymous request returned 403", refs: claimParams.content.evidence_refs, limitations: ["Only this request and identity"] } }
        const first = await handler.handle(createContext(params))
        const second = await handler.handle(createContext(params))
        expect(first.data).toMatchObject({ status: "pending", trust_level: "L0", candidate_only: true, canonical_changed: false, board_change: { board: "memory", operation: "add" } })
        expect(second.data).toEqual(first.data)
        expect(getBoardProjectKey).toHaveBeenCalledWith("web-001")
        const entries = await outbox.list()
        expect(entries).toHaveLength(1)
        expect(entries[0]?.proposal.content.title).toBe("BreachWeave [host-project-a] memory (failure): observer:solver-a")
        expect(entries[0]?.proposal.content.status).toBe("proposed")
        expect(entries[0]?.proposal.expected_version).toBe(0)
        expect(entries[0]?.proposal.target_id).toBeUndefined()
    })

    test("observer curation remains available after the executor work run is checkpointed", async () => {
        const bindingRegistry = await createBindingRegistry()
        const outbox = await createOutbox()
        const checkpointAuthority = mock(async () => {
            throw new HostBridgeError("stale_version", "work run is checkpointed")
        })
        const workManager = { checkpointAuthority } as unknown as TaricWorkManager
        const handler = createTaricProposalHandler({ settings: { enabled: true, outbox }, bindingRegistry, workManager })
        const params = { observer_board_change: { board: "memory", operation: "add", memory_kind: "evidence", content: "Fresh evidence was observed", refs: claimParams.content.evidence_refs, limitations: ["Read-only validation"] } }

        const result = await handler.handle({
            ...createContextWithWork(params, "checkpointed-run", 1),
            getWorkState: () => ({ workRunId: "checkpointed-run", attemptId: "attempt-a", generation: 1, readSeq: 9, leaseState: "active" }),
        })

        expect(result.data).toMatchObject({ status: "pending", candidate_only: true, canonical_changed: false })
        expect(checkpointAuthority).not.toHaveBeenCalled()
        expect(await outbox.list()).toHaveLength(1)
    })

    test("observer cannot choose scope or authority and invalid input never reaches the outbox", async () => {
        const outbox = await createOutbox()
        const handler = createTaricProposalHandler({ settings: { enabled: true, outbox }, bindingRegistry: await createBindingRegistry() })
        const change = { board: "idea", operation: "add", content: "Check upload route", refs: claimParams.content.evidence_refs, limitations: ["Untested hypothesis"] }
        for (const params of [
            { observer_board_change: change, engagement_id: "other" },
            { observer_board_change: { ...change, project_key: "other" } },
            { observer_board_change: { ...change, refs: ["tool:curl"] } },
            { observer_board_change: { ...change, operation: "update", target_ref: "idea_local", result: "failed" } },
        ]) {
            await expect(handler.handle(createContext(params))).rejects.toBeInstanceOf(HostBridgeError)
        }
        expect(await outbox.list()).toHaveLength(0)
    })

    test("disabled and unbound observer submissions remain degraded with no local fallback", async () => {
        const outbox = await createOutbox()
        const handler = createTaricProposalHandler({ settings: { enabled: false, outbox }, bindingRegistry: await createBindingRegistry() })
        const params = { observer_board_change: { board: "idea", operation: "add", content: "Check handler", refs: claimParams.content.evidence_refs, limitations: ["Unverified"] } }
        expect((await handler.handle(createContext(params))).data).toMatchObject({ degraded: true, reason: "taric_proposal_disabled" })
        const unbound = createTaricProposalHandler({ settings: { enabled: true, outbox }, bindingRegistry: await createBindingRegistry() })
        const context = { ...createContext(params), getSolverEnvValue: () => undefined }
        expect((await unbound.handle(context)).data).toMatchObject({ degraded: true, reason: "challenge_taric_binding_unavailable" })
        expect(await outbox.list()).toHaveLength(0)
    })

})
