import { join } from "node:path"
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent"
import {
    CHALLENGE_ENV_CHALLENGE_ID,
    CHALLENGE_ENV_TARIC_ATTEMPT_ID,
    CHALLENGE_ENV_TARIC_BINDING_ACTIVE,
    CHALLENGE_ENV_TARIC_ENGAGEMENT_ID,
    CHALLENGE_ENV_TARIC_WORK_RUN_ID,
} from "../../challenge/env"
import { TaricArtifactStore } from "../../challenge/taric-artifact-store"
import { requestHostBridge } from "../../challenge/host-bridge-client"

const DEFAULT_MAX_INLINE_CHARS = 32000

export interface TaricArtifactToolResultOptions {
    workspaceRoot: string
    maxInlineChars?: number
}

interface ToolContentBlock {
    type: string
    text?: string
}

export function serializeArtifactToolContent(content: ToolContentBlock[]): string {
    if (!Array.isArray(content) || content.length === 0) return ""
    return content
        .map((block) => (block.type === "text" ? block.text ?? "" : JSON.stringify(block)))
        .join("\n\n")
}

export function buildArtifactToolResultMessage(input: {
    contentRef: string
    hash: string
    artifactId: string
    summary: string
}): string {
    return [
        "Tool output was captured as a Taric Artifact.",
        `artifact_id: ${input.artifactId}`,
        `content_ref: ${input.contentRef}`,
        `hash: ${input.hash}`,
        "The raw artifact is not included in the model context.",
        "",
        "Bounded summary:",
        input.summary,
    ].join("\n")
}

export function taricArtifactToolResultExtension(options: TaricArtifactToolResultOptions): ExtensionFactory {
    const maxInlineChars = options.maxInlineChars ?? DEFAULT_MAX_INLINE_CHARS
    const artifactRoot = process.env.TCH_TARIC_ARTIFACT_DIR?.trim() || join(options.workspaceRoot, ".taric-artifacts")
    const store = new TaricArtifactStore({
        rootDir: artifactRoot,
        maxInlineBytes: maxInlineChars,
    })

    return (pi) => {
        pi.on("tool_result", async (event) => {
            const text = serializeArtifactToolContent(event.content)
            if (!text) return
            // Avoid creating an artifact for every trivial "ok"/"done" result.
            if (text.trim().length < 64) return

            const bindingActive = process.env[CHALLENGE_ENV_TARIC_BINDING_ACTIVE]?.trim() === "1"
            const workRunId = process.env[CHALLENGE_ENV_TARIC_WORK_RUN_ID]?.trim()
            const attemptId = process.env[CHALLENGE_ENV_TARIC_ATTEMPT_ID]?.trim()
            const challengeId = process.env[CHALLENGE_ENV_CHALLENGE_ID]?.trim()
            const engagementId = process.env[CHALLENGE_ENV_TARIC_ENGAGEMENT_ID]?.trim() || challengeId || "workspace"
            if (bindingActive && workRunId && engagementId) {
                try {
                    const captured = await requestHostBridge<{
                        captured: boolean
                        truncated?: boolean
                        artifact_id?: string
                        content_ref?: string
                        hash?: string
                        summary?: string
                    }>("taric_tool_result_capture", {
                        challenge_id: challengeId,
                        engagement_id: engagementId,
                        work_run_id: workRunId,
                        ...(attemptId ? { attempt_id: attemptId } : {}),
                        tool_name: "toolName" in event && typeof event.toolName === "string" ? event.toolName : "tool",
                        text,
                    })
                    if (!captured.captured) return
                    if (captured.truncated && captured.content_ref && captured.hash) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: buildArtifactToolResultMessage({
                                        artifactId: captured.artifact_id ?? captured.content_ref,
                                        contentRef: captured.content_ref,
                                        hash: captured.hash,
                                        summary: captured.summary ?? "",
                                    }),
                                },
                            ],
                            details: {
                                type: "taric_artifact_tool_result",
                                truncated: true,
                                originalChars: text.length,
                                artifact_id: captured.artifact_id,
                                content_ref: captured.content_ref,
                                hash: captured.hash,
                            },
                        }
                    }
                    return {
                        details: {
                            type: "taric_artifact_tool_result",
                            truncated: false,
                            originalChars: text.length,
                            artifact_id: captured.artifact_id,
                            content_ref: captured.content_ref,
                            hash: captured.hash,
                        },
                    }
                } catch {
                    // Fall back to solver-local capture if the host bridge is unavailable.
                }
            }

            const artifact = await store.begin({
                engagementId,
                ...(attemptId ? { attemptId } : {}),
                ...(workRunId ? { workRunId } : {}),
                totalBytes: new TextEncoder().encode(text).length,
                acl: { read: true },
            })
            await store.append(artifact.artifact_id, text)
            const committed = await store.commit(artifact.artifact_id)
            // Normal-sized evidence stays in the model context, but it is also
            // persisted so a checkpoint can reference a real artifact hash.
            if (text.length <= maxInlineChars) {
                return {
                    details: {
                        type: "taric_artifact_tool_result",
                        truncated: false,
                        originalChars: text.length,
                        artifact_id: committed.artifact_id,
                        content_ref: committed.content_ref,
                        hash: committed.hash,
                    },
                }
            }
            return {
                content: [
                    {
                        type: "text",
                        text: buildArtifactToolResultMessage({
                            artifactId: committed.artifact_id,
                            contentRef: committed.content_ref,
                            hash: committed.hash ?? "",
                            summary: committed.summary,
                        }),
                    },
                ],
                details: {
                    type: "taric_artifact_tool_result",
                    truncated: true,
                    originalChars: text.length,
                    artifact_id: committed.artifact_id,
                    content_ref: committed.content_ref,
                    hash: committed.hash,
                },
            }
        })
    }
}
