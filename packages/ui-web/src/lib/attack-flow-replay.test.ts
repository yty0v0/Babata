import { expect, test } from "bun:test"
import { replayStep } from "./attack-flow-replay"

test("opening or scrubbing the full flow remains paused with looping enabled", () => {
    expect(replayStep(169, 169, false, true)).toBe("idle")
    expect(replayStep(0, 0, false, true)).toBe("idle")
    expect(replayStep(80, 169, false, true)).toBe("idle")
})
test("an empty timeline never loops", () => {
    expect(replayStep(0, 0, true, true)).toBe("stop")
})
test("only explicit playback may advance or loop", () => {
    expect(replayStep(168, 169, true, false)).toBe("advance")
    expect(replayStep(169, 169, true, false)).toBe("stop")
    expect(replayStep(169, 169, true, true)).toBe("loop")
})
