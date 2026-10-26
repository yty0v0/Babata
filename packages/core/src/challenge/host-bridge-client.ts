import { HostBridgeError, isHostBridgeErrorCode } from "./host-bridge-types"
import type { HostBridgeAction, HostBridgeRequestEvent } from "./host-bridge-types"

interface PendingRequest {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: Timer
}

const pendingRequests = new Map<string, PendingRequest>()

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
}

function serializeJsonLine(value: unknown): string {
    return `${JSON.stringify(value)}\n`
}

export async function requestHostBridge<T>(action: HostBridgeAction, params: unknown): Promise<T> {
    const requestId = crypto.randomUUID()
    const event: HostBridgeRequestEvent = {
        type: "host_bridge_request",
        request_id: requestId,
        action,
        params,
    }

    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingRequests.delete(requestId)
            reject(new Error(`host bridge timeout: ${action}`))
        }, 30_000)

        pendingRequests.set(requestId, {
            resolve: (value) => resolve(value as T),
            reject,
            timer,
        })

        try {
            process.stdout.write(serializeJsonLine(event))
        } catch (error) {
            clearTimeout(timer)
            pendingRequests.delete(requestId)
            reject(new Error(`host bridge write failed: ${toErrorMessage(error)}`))
        }
    })
}

function parseHostBridgeError(error?: string): Error {
    const text = error?.trim() || "host bridge request failed"
    try {
        const parsed = JSON.parse(text) as { code?: unknown; message?: unknown; details?: unknown }
        if (isHostBridgeErrorCode(parsed.code) && typeof parsed.message === "string") {
            const details = parsed.details && typeof parsed.details === "object" && !Array.isArray(parsed.details)
                ? parsed.details as Record<string, unknown>
                : undefined
            return new HostBridgeError(parsed.code, parsed.message, details)
        }
    } catch {
        // Preserve plain legacy error strings.
    }
    return new Error(text)
}

export function resolveHostBridgeResponse(requestId: string, success: boolean, data?: unknown, error?: string): void {
    const pending = pendingRequests.get(requestId)
    if (!pending) return
    pendingRequests.delete(requestId)
    clearTimeout(pending.timer)
    if (!success) {
        pending.reject(new Error(error?.trim() || "host bridge request failed"))
        return
    }
    pending.resolve(data)
}
