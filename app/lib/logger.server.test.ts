import {afterEach, describe, expect, it, vi} from "vitest"

import {logger} from "~/lib/logger.server"

afterEach(() => {
    vi.restoreAllMocks()
})

describe("logger", () => {
    it.each([
        ["debug", "debug"],
        ["info", "info"],
        ["warn", "warn"],
        ["error", "error"],
    ] as const)("writes %s records with their level", (method, level) => {
        const consoleSpy = vi
            .spyOn(console, method)
            .mockImplementation(() => {})

        logger[method]({message: "test.message", value: 42})

        expect(consoleSpy).toHaveBeenCalledWith({
            message: "test.message",
            value: 42,
            level,
        })
    })

    it("serializes errors as structured fields", () => {
        const consoleSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {})
        const error = new TypeError("Something broke")

        logger.error({message: "test.failed", error})

        expect(consoleSpy).toHaveBeenCalledWith({
            message: "test.failed",
            error: {
                name: "TypeError",
                message: "Something broke",
                stack: expect.any(String),
            },
            level: "error",
        })
    })

    it("does not allow records to override their level", () => {
        const consoleSpy = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {})

        logger.warn({message: "test.warning", level: "info"})

        expect(consoleSpy).toHaveBeenCalledWith({
            message: "test.warning",
            level: "warn",
        })
    })
})
