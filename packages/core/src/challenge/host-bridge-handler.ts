import type { ChallengeManager } from "./manager"
import { CHALLENGE_ENV_CHALLENGE_ID } from "./env"
import type { IdeaStatus, MemoryKind } from "./memory"
import type { HostBridgeHandleContext, HostBridgeHandleResult, HostBridgeHandler, SolverInstance } from "../runtime/types"
import { HostBridgeError } from "./host-bridge-types"

function getObjectValue(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

function getRequiredString(data: Record<string, unknown>, key: string): string {
    const value = data[key]
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${key} is required`)
    }
    return value.trim()
}

function getOptionalString(data: Record<string, unknown>, key: string): string | undefined {
    const value = data[key]
    if (typeof value !== "string") return
    const text = value.trim()
    return text || undefined
}

function getStringArray(data: Record<string, unknown>, key: string): string[] {
    const value = data[key]
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === "string")
}

function getMemoryKind(data: Record<string, unknown>): MemoryKind {
    const value = getRequiredString(data, "kind")
    if (value === "fact" || value === "evidence" || value === "failure" || value === "note" || value === "hint") {
        return value
    }
    throw new Error(`invalid memory kind: ${value}`)
}

function getOptionalIdeaStatus(data: Record<string, unknown>): IdeaStatus | undefined {
    const value = getOptionalString(data, "status")
    if (!value) return
    if (value === "pending" || value === "testing" || value === "verified" || value === "failed" || value === "skipped") {
        return value
    }
    throw new Error(`invalid idea status: ${value}`)
}

async function getRequiredChallengeId(context: HostBridgeHandleContext): Promise<string> {
    const envChallengeId = context.getSolverEnvValue(CHALLENGE_ENV_CHALLENGE_ID)?.trim()
    if (envChallengeId) return envChallengeId

    const solverChallengeId = context.getSolver?.()?.challengeId?.trim()
    if (solverChallengeId) return solverChallengeId

    const startup = await context.getSolverStartup?.()
    if (startup && typeof startup === "object" && "init" in startup) {
        const init = (startup as { init?: { challengeId?: unknown } }).init
        const startupChallengeId = init && typeof init === "object" && typeof init.challengeId === "string" ? init.challengeId.trim() : ""
        if (startupChallengeId) return startupChallengeId
    }

    throw new Error(`${CHALLENGE_ENV_CHALLENGE_ID} is required for challenge actions`)
}

function getSolverPromptName(solver?: SolverInstance): string | undefined {
    return solver?.promptName?.trim() || undefined
}

function getSolverModelName(startup: unknown): string | undefined {
    if (!startup || typeof startup !== "object" || !("sessionOptions" in startup)) return
    const sessionOptions = (startup as { sessionOptions?: unknown }).sessionOptions
    if (!sessionOptions || typeof sessionOptions !== "object" || !("model" in sessionOptions)) return
    const model = (sessionOptions as { model?: unknown }).model
    if (!model || typeof model !== "object") return
    const provider = (model as { provider?: unknown }).provider
    const id = (model as { id?: unknown }).id
    const providerText = typeof provider === "string" ? provider.trim() : ""
    const idText = typeof id === "string" ? id.trim() : ""
    const text = [providerText, idText].filter(Boolean).join("/")
    return text || undefined
}

function sendSteerToSolver(context: HostBridgeHandleContext, solverId: string, message: string): void {
    const text = message.trim()
    if (!text) return
    context.sendCommand?.(solverId, {
        type: "steer",
        message: text,
    })
}

function sendHintToSolver(context: HostBridgeHandleContext, solverId: string, hintContent: string): void {
    const message = hintContent.trim()
    if (!message) return
    sendSteerToSolver(context, solverId, `系统同步：赛题 hint 已更新。\n- 立即吸收这条 hint，并结合当前路线评估是否需要转向。\n- 如果它改变了攻击面理解，优先刷新 memory_list / idea_list。\n- hint:\n${message}`)
}

function broadcastHintToChallengeSolvers(context: HostBridgeHandleContext, challengeId: string, hintContent: string): void {
    const targetChallengeId = challengeId.trim()
    const message = hintContent.trim()
    if (!targetChallengeId || !message) return
    for (const solver of context.listSolvers?.() ?? []) {
        if (solver.challengeId !== targetChallengeId) continue
        if (solver.status !== "running") continue
        try {
            sendHintToSolver(context, solver.id, message)
        } catch {
            // ignore inactive solver pipes
        }
    }
}

async function handleChallengeAction(
    challengeManager: ChallengeManager,
    context: HostBridgeHandleContext,
): Promise<HostBridgeHandleResult> {
    const { solverId, action, params, getSolverEnvValue, getSolver, getSolverStartup } = context
    const data = getObjectValue(params)

    switch (action) {
        case "challenge_get_state": {
            const challengeId = await getRequiredChallengeId(context)
            const challenge = await challengeManager.getChallenge(challengeId)
            const isCompleted = await challengeManager.isChallengeCompleted(challengeId)
            return { handled: true, data: { challenge_id: challengeId, challenge, is_completed: isCompleted } }
        }
        case "challenge_get_hint": {
            const challengeId = await getRequiredChallengeId(context)
            const challenge = await challengeManager.getChallenge(challengeId)
            const cachedHint = challenge?.hint_content?.trim()
            if (cachedHint) {
                return {
                    handled: true,
                    data: {
                        code: challengeId,
                        hint_content: cachedHint,
                    },
                }
            }
            const result = await challengeManager.getHint(challengeId)
            if (result.remote.hint_content?.trim()) {
                broadcastHintToChallengeSolvers(context, challengeId, result.remote.hint_content)
            }
            return { handled: true, data: result.remote }
        }
        case "challenge_submit_report": {
            const challengeId = await getRequiredChallengeId(context)
            const assetHash = getRequiredString(data, "asset_hash")
            const report = getRequiredString(data, "report")
            const workState = context.getWorkState?.()
            await challengeManager.ensureTaricHostCheckpoint?.({
                challengeId,
                solverId,
                assetHash,
            })
            await challengeManager.assertTaricReportGate?.({
                challengeId,
                solverId,
                assetHash,
                ...(workState?.workRunId ? { workRunId: workState.workRunId } : {}),
            })
            const result = await challengeManager.submitReport(challengeId, {
                assetHash,
                report,
                ...(typeof data.coverage_state === "string" ? { coverageState: data.coverage_state as "untested" | "blocked" | "negative" | "positive" | "unknown" } : {}),
                ...(typeof data.coverage_reason === "string" ? { coverageReason: data.coverage_reason } : {}),
                solverId,
                ...(workState?.workRunId ? { workRunId: workState.workRunId } : {}),
                promptName: getSolverPromptName(getSolver?.()),
                modelName: getSolverModelName((await getSolverStartup?.()) ?? undefined),
            })
            await challengeManager.closeTaricWorkItem?.(challengeId, solverId)
            return { handled: true, data: { challenge_id: challengeId, ...result } }
        }
        case "challenge_is_completed": {
            const challengeId = await getRequiredChallengeId(context)
            const isCompleted = await challengeManager.isChallengeCompleted(challengeId)
            return { handled: true, data: { challenge_id: challengeId, is_completed: isCompleted } }
        }
        case "challenge_memory_list": {
            const challengeId = await getRequiredChallengeId(context)
            const legacyTaricProjection = await challengeManager.isTaricAuthoritativeActive?.(challengeId)
                && !await challengeManager.isTaricProjectManaged?.(challengeId)
            const board = legacyTaricProjection
                ? { memory: await challengeManager.listTaricMemoryProjection(challengeId) }
                : await challengeManager.readMemoryBoard?.(challengeId)
            const items = board?.memory ?? await challengeManager.listMemory(challengeId)
            const read_diagnostics = board && "diagnostics" in board ? board.diagnostics : await challengeManager.getMemoryReadDiagnostics?.(challengeId)
            return { handled: true, data: { challenge_id: challengeId, items, ...(read_diagnostics ? { read_diagnostics } : {}) } }
        }
        case "challenge_memory_add": {
            const challengeId = await getRequiredChallengeId(context)
            if (await challengeManager.isTaricAuthoritativeActive?.(challengeId) || await challengeManager.isTaricProjectManaged?.(challengeId)) {
                throw new HostBridgeError("authorization_error", "Taric-managed memory is proposal-only; direct memory_add is unavailable")
            }
            const role = context.getSolver?.()?.role
            const source = `${role ?? "observer"}:${solverId}`
            const entry = await challengeManager.appendMemory({
                challengeId,
                kind: getMemoryKind(data),
                content: getRequiredString(data, "content"),
                refs: getStringArray(data, "refs"),
                source,
            })
            return { handled: true, data: { challenge_id: challengeId, entry } }
        }
        case "challenge_idea_list": {
            const challengeId = await getRequiredChallengeId(context)
            const legacyTaricProjection = await challengeManager.isTaricAuthoritativeActive?.(challengeId)
                && !await challengeManager.isTaricProjectManaged?.(challengeId)
            const board = legacyTaricProjection
                ? { ideas: await challengeManager.listTaricIdeasProjection(challengeId) }
                : await challengeManager.readMemoryBoard?.(challengeId)
            const items = board?.ideas ?? await challengeManager.listIdeas(challengeId)
            const read_diagnostics = board && "diagnostics" in board ? board.diagnostics : await challengeManager.getMemoryReadDiagnostics?.(challengeId)
            return { handled: true, data: { challenge_id: challengeId, items, ...(read_diagnostics ? { read_diagnostics } : {}) } }
        }
        case "challenge_idea_search": {
            const challengeId = await getRequiredChallengeId(context)
            const query = getRequiredString(data, "query")
            const legacyTaricProjection = await challengeManager.isTaricAuthoritativeActive?.(challengeId)
                && !await challengeManager.isTaricProjectManaged?.(challengeId)
            const items = legacyTaricProjection
                ? await challengeManager.searchTaricIdeasProjection(challengeId, query)
                : await challengeManager.searchIdeas(challengeId, query)
            const read_diagnostics = await challengeManager.getMemoryReadDiagnostics?.(challengeId)
            return { handled: true, data: { challenge_id: challengeId, items, ...(read_diagnostics ? { read_diagnostics } : {}) } }
        }
        case "challenge_idea_add": {
            const challengeId = await getRequiredChallengeId(context)
            if (await challengeManager.isTaricAuthoritativeActive?.(challengeId) || await challengeManager.isTaricProjectManaged?.(challengeId)) {
                throw new HostBridgeError("authorization_error", "Taric-managed ideas are proposal-only; direct idea_add is unavailable")
            }
            const status = getOptionalIdeaStatus(data)
            const result = await challengeManager.addIdea(challengeId, {
                content: getRequiredString(data, "content"),
                ...(status ? { status } : {}),
                ...(data.result !== undefined ? { result: getOptionalString(data, "result") ?? "" } : {}),
            })
            return { handled: true, data: { challenge_id: challengeId, ...result } }
        }
        default:
            return { handled: false }
    }
}

export function createChallengeHostBridgeHandler(challengeManager: ChallengeManager): HostBridgeHandler {
    return {
        async handle(context) {
            return handleChallengeAction(challengeManager, context)
        },
    }
}
