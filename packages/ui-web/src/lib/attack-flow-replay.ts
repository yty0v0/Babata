export function replayStep(cursorIndex: number, eventCount: number, isPlaying: boolean, needLoop: boolean): "idle" | "stop" | "loop" | "advance" {
    if (!isPlaying) return "idle"
    if (eventCount === 0) return "stop"
    if (cursorIndex >= eventCount) return needLoop ? "loop" : "stop"
    return "advance"
}
