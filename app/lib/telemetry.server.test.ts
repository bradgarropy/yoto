import {afterEach, describe, expect, it, vi} from "vitest"

const {writeDataPoint} = vi.hoisted(() => ({
    writeDataPoint: vi.fn(),
}))

vi.mock("cloudflare:workers", () => ({
    env: {
        ANALYTICS: {
            writeDataPoint,
        },
    },
}))

import {EVENT, telemetry} from "~/lib/telemetry.server"

afterEach(() => {
    vi.restoreAllMocks()
    writeDataPoint.mockClear()
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

        telemetry[method](EVENT.AUTH.LOGIN.COMPLETED, {
            durationMs: 250,
        })

        expect(consoleSpy).toHaveBeenCalledWith({
            durationMs: 250,
            event: EVENT.AUTH.LOGIN.COMPLETED,
            level,
        })
        expect(writeDataPoint).toHaveBeenCalledOnce()
    })

    it("supports events without context", () => {
        const consoleSpy = vi
            .spyOn(console, "info")
            .mockImplementation(() => {})

        telemetry.info(EVENT.AUTH.LOGIN.STARTED)

        expect(consoleSpy).toHaveBeenCalledWith({
            event: EVENT.AUTH.LOGIN.STARTED,
            level: "info",
        })
        expect(writeDataPoint).toHaveBeenCalledOnce()
    })

    it("does not allow context to override reserved fields", () => {
        const consoleSpy = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {})

        const payload = {
            stage: "complete",
            reason: "access_denied",
            durationMs: 250,
            event: "wrong.event",
            level: "info",
        } as const

        telemetry.warn(EVENT.AUTH.LOGIN.FAILED, payload)

        expect(consoleSpy).toHaveBeenCalledWith({
            stage: "complete",
            reason: "access_denied",
            durationMs: 250,
            event: EVENT.AUTH.LOGIN.FAILED,
            level: "warn",
        })
        expect(writeDataPoint).toHaveBeenCalledOnce()
    })
})
