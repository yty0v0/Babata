import { useCallback, useState } from "react"
import { CheckIcon, RefreshCwIcon, XIcon } from "lucide-react"
import { taric } from "../../lib/api"
import type { TaricProposalListItem } from "../../lib/api"
import { useFetch } from "../../hooks/use-fetch"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { toast } from "sonner"

function formatTime(value?: string) {
    if (!value) return "unknown"
    return new Date(value).toLocaleString()
}

function proposalSummary(proposal: TaricProposalListItem["proposal"]): string {
    const content = proposal.content as Record<string, unknown>
    if (typeof content.proposition === "string") return content.proposition
    if (typeof content.title === "string") return content.title
    if (typeof content.reason === "string") return content.reason
    if (Array.isArray(content.next_steps)) {
        const step = content.next_steps.find((item): item is string => typeof item === "string")
        if (step) return step
    }
    return proposal.kind
}

function textList(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === "string")
}

function admissionBadgeClass(state?: string) {
    if (state === "approved") return "border-green-600/30 bg-green-500/15 text-green-700"
    if (state === "rejected") return "border-red-600/30 bg-red-500/15 text-red-700"
    return ""
}

export function TaricProposalsPanel({ challengeId }: { challengeId: string }) {
    const statusFetcher = useCallback(() => taric.status(), [])
    const { data: status } = useFetch(statusFetcher)
    const proposalsFetcher = useCallback(() => taric.proposals(challengeId), [challengeId])
    const { data, loading, error, reload } = useFetch(proposalsFetcher)
    const [busyKey, setBusyKey] = useState("")
    const [rejectKey, setRejectKey] = useState("")
    const [rejectReason, setRejectReason] = useState("")

    const proposals = data ?? []

    async function handleApprove(entry: TaricProposalListItem) {
        setBusyKey(entry.idempotency_key)
        try {
            await taric.approve(entry.idempotency_key)
            toast.success("Proposal approved")
            reload()
        } catch (approveError) {
            toast.error(approveError instanceof Error ? approveError.message : String(approveError))
        } finally {
            setBusyKey("")
        }
    }

    async function handleReject(entry: TaricProposalListItem) {
        const reason = rejectReason.trim()
        if (!reason) {
            toast.error("Rejection reason is required")
            return
        }
        setBusyKey(entry.idempotency_key)
        try {
            await taric.reject(entry.idempotency_key, reason)
            toast.success("Proposal rejected")
            setRejectKey("")
            setRejectReason("")
            reload()
        } catch (rejectError) {
            toast.error(rejectError instanceof Error ? rejectError.message : String(rejectError))
        } finally {
            setBusyKey("")
        }
    }

    if (loading) {
        return <div className="text-sm text-muted-foreground">Loading Taric proposals...</div>
    }

    if (error) {
        return <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>
    }

    if (proposals.length === 0) {
        return <div className="text-sm text-muted-foreground">No Taric proposals yet.</div>
    }

    return (
        <div className="min-w-0 space-y-3">
            {status && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3 text-sm">
                    <Badge variant="outline" className={status.enabled ? "border-green-600/30 bg-green-500/15 text-green-700" : ""}>
                        {status.enabled ? "enabled" : "disabled"}
                    </Badge>
                    <Badge variant="outline">{status.sidecarRunning ? `sidecar :${status.sidecarPort ?? 0}` : "sidecar stopped"}</Badge>
                    <Badge variant="outline">{status.authorityReachable ? "authority reachable" : "authority unavailable"}</Badge>
                    <span className="text-xs text-muted-foreground">
                        pending {status.outboxPending} / failed {status.outboxFailed}
                    </span>
                    {status.degradationReasons.length > 0 && (
                        <span className="min-w-0 flex-1 break-words text-xs text-muted-foreground">
                            {status.degradationReasons.join("; ")}
                        </span>
                    )}
                </div>
            )}
            {proposals.map((entry) => {
                const busy = busyKey === entry.idempotency_key
                const limitations = textList((entry.proposal.content as Record<string, unknown>).limitations)
                const evidenceRefs = textList((entry.proposal.content as Record<string, unknown>).evidence_refs)
                return (
                    <div key={entry.idempotency_key} className="min-w-0 rounded-lg border px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <Badge variant="outline">{entry.proposal.kind}</Badge>
                                <Badge variant="outline" className={admissionBadgeClass(entry.admission_state)}>
                                    {entry.admission_state ?? "pending"}
                                </Badge>
                                <Badge variant="outline">{entry.admission_mode ?? "hitl_l1"}</Badge>
                            </div>
                            <div className="flex items-center gap-1">
                                {entry.admission_state === "approved" || entry.admission_state === "rejected" ? null : (
                                    <>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={busy}
                                            onClick={() => void handleApprove(entry)}
                                        >
                                            <CheckIcon className="size-4" />
                                            Approve
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={busy}
                                            onClick={() => {
                                                setRejectKey(entry.idempotency_key)
                                                setRejectReason("")
                                            }}
                                        >
                                            <XIcon className="size-4" />
                                            Reject
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="mt-2 break-words text-sm font-medium">{proposalSummary(entry.proposal)}</div>
                        <div className="mt-2 grid gap-1 break-all text-xs text-muted-foreground sm:grid-cols-2">
                            <div>proposer {entry.role}:{entry.solver_id}</div>
                            <div>engagement {entry.engagement_id}</div>
                            <div>scope challenge {entry.challenge_id}</div>
                            <div>idempotency {entry.idempotency_key}</div>
                            <div>status {entry.status}</div>
                        </div>

                        {evidenceRefs.length > 0 && (
                            <div className="mt-2">
                                <div className="text-xs font-medium text-foreground">Evidence refs</div>
                                <div className="mt-1 break-all text-xs text-muted-foreground">{evidenceRefs.join(", ")}</div>
                            </div>
                        )}
                        {limitations.length > 0 && (
                            <div className="mt-2">
                                <div className="text-xs font-medium text-foreground">Limitations</div>
                                <div className="mt-1 break-words text-xs text-muted-foreground">{limitations.join(", ")}</div>
                            </div>
                        )}

                        {entry.reviewed_by && (
                            <div className="mt-2 text-xs text-muted-foreground">
                                reviewed by {entry.reviewed_by}
                                {entry.review_reason ? `: ${entry.review_reason}` : ""}
                            </div>
                        )}
                        {entry.admission_error && <div className="mt-2 text-xs text-destructive">{entry.admission_error}</div>}
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 break-all text-xs text-muted-foreground">
                            <span>created {formatTime(entry.created_at)}</span>
                            {entry.acknowledged_at && <span>acknowledged {formatTime(entry.acknowledged_at)}</span>}
                            <span>updated {formatTime(entry.updated_at)}</span>
                        </div>

                        {rejectKey === entry.idempotency_key && entry.admission_state !== "approved" && entry.admission_state !== "rejected" && (
                            <div className="mt-3 space-y-2">
                                <Textarea
                                    value={rejectReason}
                                    onChange={(event) => setRejectReason(event.target.value)}
                                    placeholder="Rejection reason"
                                    rows={3}
                                />
                                <div className="flex items-center gap-2">
                                    <Button size="sm" disabled={busy || !rejectReason.trim()} onClick={() => void handleReject(entry)}>
                                        <XIcon className="size-4" />
                                        Confirm rejection
                                    </Button>
                                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRejectKey("")}>
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}
            <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => void reload()}>
                    <RefreshCwIcon className="size-4" />
                    Refresh
                </Button>
            </div>
        </div>
    )
}
