import {describe, expect, it} from "vitest"

import {formatDuration} from "./format"

describe("formatDuration", () => {
    it("should return empty string for undefined", () => {
        expect(formatDuration(undefined)).toBe("")
    })

    it("should return empty string for 0", () => {
        expect(formatDuration(0)).toBe("")
    })

    it("should format seconds only", () => {
        expect(formatDuration(5)).toBe("0:05")
        expect(formatDuration(30)).toBe("0:30")
    })

    it("should format minutes and seconds", () => {
        expect(formatDuration(65)).toBe("1:05")
        expect(formatDuration(90)).toBe("1:30")
        expect(formatDuration(125)).toBe("2:05")
    })

    it("should pad seconds with leading zero", () => {
        expect(formatDuration(61)).toBe("1:01")
        expect(formatDuration(600)).toBe("10:00")
    })

    it("should handle large durations", () => {
        expect(formatDuration(3600)).toBe("60:00")
        expect(formatDuration(3661)).toBe("61:01")
    })
})
