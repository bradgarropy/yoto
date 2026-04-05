import {describe, expect, it} from "vitest"

import {isValidOrigin} from "./security.server"

const createRequest = (url: string, origin?: string) => {
    const headers = new Headers()

    if (origin) {
        headers.set("Origin", origin)
    }

    return new Request(url, {method: "POST", headers})
}

describe("isValidOrigin", () => {
    it("should return true when origin matches the request host", () => {
        const request = createRequest(
            "https://yoto.bradgarropy.com/api/feedback",
            "https://yoto.bradgarropy.com",
        )

        expect(isValidOrigin(request)).toBe(true)
    })

    it("should return true when origin matches on localhost", () => {
        const request = createRequest(
            "http://localhost:5173/api/feedback",
            "http://localhost:5173",
        )

        expect(isValidOrigin(request)).toBe(true)
    })

    it("should return false when origin header is missing", () => {
        const request = createRequest(
            "https://yoto.bradgarropy.com/api/feedback",
        )

        expect(isValidOrigin(request)).toBe(false)
    })

    it("should return false when origin does not match the request host", () => {
        const request = createRequest(
            "https://yoto.bradgarropy.com/api/feedback",
            "https://evil.com",
        )

        expect(isValidOrigin(request)).toBe(false)
    })

    it("should return false when origin is a malformed URL", () => {
        const request = createRequest(
            "https://yoto.bradgarropy.com/api/feedback",
            "not-a-url",
        )

        expect(isValidOrigin(request)).toBe(false)
    })
})
