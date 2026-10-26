import { useEffect, useState } from "react"
import { hostSettings } from "../../lib/api"
import { useFetch } from "../../hooks/use-fetch"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Label } from "../ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { Switch } from "../ui/switch"

function phaseFromSettings(value: { guardrail?: { phase?: string } } | null | undefined): "observe" | "enforce" {
    return value?.guardrail?.phase === "enforce" ? "enforce" : "observe"
}

export function GuardrailPage() {
    const { data, loading, error, reload } = useFetch(hostSettings.get)
    const [enabled, setEnabled] = useState(true)
    const [phase, setPhase] = useState<"observe" | "enforce">("observe")
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState("")

    useEffect(() => {
        setEnabled(data?.guardrail?.enabled !== false)
        setPhase(phaseFromSettings(data))
    }, [data])

    async function handleSave() {
        setSaving(true)
        setMessage("")
        try {
            await hostSettings.set({
                guardrail: {
                    enabled,
                    phase,
                },
            })
            setMessage("Saved")
            reload()
        } catch (saveError) {
            setMessage(saveError instanceof Error ? saveError.message : String(saveError))
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div className="min-w-0 space-y-1">
                    <Label>Enabled</Label>
                    <p className="text-sm text-muted-foreground">
                        360 deep-mode guardrail.
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                    <Badge variant={!enabled ? "outline" : phase === "enforce" ? "destructive" : "secondary"}>
                        {!enabled ? "disabled" : phase === "enforce" ? "enforcement active" : "observation active"}
                    </Badge>
                    <Switch checked={enabled} onCheckedChange={setEnabled} className="mt-0.5" />
                </div>
            </div>

            <div className="space-y-2 rounded-lg border p-4">
                <Label>Phase</Label>
                <Select value={phase} onValueChange={(value) => setPhase(value === "enforce" ? "enforce" : "observe")}>
                    <SelectTrigger disabled={!enabled}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="observe">observe</SelectItem>
                        <SelectItem value="enforce">enforce</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                    observe records decisions; enforce blocks violating traffic.
                </p>
            </div>

            <div className="flex items-center gap-3">
                <Button type="button" disabled={saving} onClick={handleSave}>
                    {saving ? "Saving..." : "Save"}
                </Button>
                {loading && <span className="text-sm text-muted-foreground">Loading...</span>}
                {!loading && message && <span className="text-sm text-muted-foreground">{message}</span>}
                {!loading && error && <span className="text-sm text-red-500">{error}</span>}
            </div>
        </div>
    )
}
