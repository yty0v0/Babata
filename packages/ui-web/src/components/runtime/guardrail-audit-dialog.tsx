import { useEffect, useState } from "react"
import { runtime, type GuardrailAuditSummary } from "../../lib/api"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../ui/dialog"
import { Separator } from "../ui/separator"

function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return timestamp
    return date.toLocaleString()
}

function decisionBadge(decision: string) {
    if (decision === "blocked") return <Badge variant="destructive">blocked</Badge>
    if (decision === "observed") return <Badge variant="secondary">observed</Badge>
    return <Badge variant="outline">allowed</Badge>
}

export function SolverGuardrailAuditDialog({
    solverId,
    open,
    onOpenChange,
}: {
    solverId: string
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const [data, setData] = useState<GuardrailAuditSummary | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [filter, setFilter] = useState<"all" | "observed" | "blocked" | "allowed">("all")

    useEffect(() => {
        if (!open || !solverId) return
        let active = true
        setLoading(true)
        setError("")
        runtime
            .guardrailAudit(solverId)
            .then((next) => {
                if (active) setData(next)
            })
            .catch((reason) => {
                if (active) setError(reason instanceof Error ? reason.message : String(reason))
            })
            .finally(() => {
                if (active) setLoading(false)
            })
        return () => {
            active = false
        }
    }, [solverId, open])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Guardrail Audit</DialogTitle>
                    <DialogDescription>
                        Observed and blocked safety guardrail decisions for this solver.
                    </DialogDescription>
                </DialogHeader>
                <Separator />
                <div className="max-h-[60vh] overflow-y-auto">
                    {loading && <div className="py-6 text-sm text-muted-foreground">Loading...</div>}
                    {!loading && error && <div className="py-6 text-sm text-destructive">{error}</div>}
                    {!loading && !error && data && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-2 text-sm">
                                <Badge variant="outline">observed {data.observed}</Badge>
                                <Badge variant="destructive">blocked {data.blocked}</Badge>
                                <Badge variant="outline">allowed {data.allowed}</Badge>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {(["all", "observed", "blocked", "allowed"] as const).map((value) => (
                                    <Button key={value} variant={filter === value ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => setFilter(value)}>
                                        {value}
                                    </Button>
                                ))}
                            </div>
                            {data.events.filter((event) => filter === "all" || event.decision === filter).length === 0 ? (
                                <div className="py-6 text-sm text-muted-foreground">No guardrail audit records.</div>
                            ) : (
                                <div className="rounded-md border divide-y">
                                    {data.events.filter((event) => filter === "all" || event.decision === filter).map((event, index) => (
                                        <div key={`${event.timestamp}-${index}`} className="grid gap-2 px-3 py-2 text-sm md:grid-cols-[150px_100px_1fr]">
                                            <div className="text-xs text-muted-foreground">{formatTimestamp(event.timestamp)}</div>
                                            <div className="min-w-0">
                                                <div className="font-mono text-xs">{event.toolName}</div>
                                                <div className="text-xs text-muted-foreground">{event.solverId ?? "-"}</div>
                                            </div>
                                            <div className="min-w-0 space-y-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {decisionBadge(event.decision)}
                                                    {event.ruleId && <code className="text-xs">{event.ruleId}</code>}
                                                </div>
                                                {event.reason && <div className="break-words text-xs text-muted-foreground">{event.reason}</div>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
