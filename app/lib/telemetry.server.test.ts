import {afterEach, describe, expect, it, vi} from "vitest"

import {EVENT, telemetry} from "~/lib/telemetry.server"

afterEach(() => {
    vi.restoreAllMocks()
})

describe("telemetry", () => {
    it.each([
        ["debug", "debug"],
        ["info", "info"],
        ["warn", "warn"],
        ["error", "error"],
    ] as const)("writes %s events as structured logs", (method, level) => {
        const consoleSpy = vi
            .spyOn(console, method)
            .mockImplementation(() => {})

        telemetry[method](EVENT.AUTH.COMPLETED, {
            importId: "import-123",
            durationMs: 250,
        })

        expect(consoleSpy).toHaveBeenCalledWith({
            importId: "import-123",
            durationMs: 250,
            event: EVENT.AUTH.COMPLETED,
            level,
        })
    })

    it("supports events without context", () => {
        const consoleSpy = vi
            .spyOn(console, "info")
            .mockImplementation(() => {})

        telemetry.info(EVENT.AUTH.STARTED)

        expect(consoleSpy).toHaveBeenCalledWith({
            event: EVENT.AUTH.STARTED,
            level: "info",
        })
    })

    it("does not allow context to override reserved fields", () => {
        const consoleSpy = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {})

        telemetry.warn(EVENT.AUTH.FAILED, {
            event: "wrong.event",
            level: "info",
        })

        expect(consoleSpy).toHaveBeenCalledWith({
            event: EVENT.AUTH.FAILED,
            level: "warn",
        })
    })
})
