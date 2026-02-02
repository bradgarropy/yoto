import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {getToken, login, logout, requireAuth, status} from "~/yoto/auth"
import {deleteAuth, readAuth, writeAuth} from "~/yoto/config"

// Mock the config module - auth.ts's immediate dependency
vi.mock("~/yoto/config", () => ({
    readAuth: vi.fn(),
    writeAuth: vi.fn(),
    deleteAuth: vi.fn(),
}))

// Helper to create a JWT token with a specific expiration
const createMockJwt = (expiresAt: number): string => {
    // JWT format: header.payload.signature
    const header = Buffer.from(
        JSON.stringify({alg: "HS256", typ: "JWT"}),
    ).toString("base64url")

    const payload = Buffer.from(
        JSON.stringify({exp: expiresAt, sub: "test-user"}),
    ).toString("base64url")

    const signature = "mock-signature"
    return `${header}.${payload}.${signature}`
}

// Type the mocked functions
const mockReadAuth = vi.mocked(readAuth)
const mockWriteAuth = vi.mocked(writeAuth)
const mockDeleteAuth = vi.mocked(deleteAuth)

beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    // Set current time to 2026-01-01 00:00:00 UTC
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
})

afterEach(() => {
    vi.useRealTimers()
})

describe("login", () => {
    it("should save valid token and return expiration info", () => {
        const now = Math.floor(Date.now() / 1000)
        const expiresAt = now + 3600 // 1 hour from now
        const token = createMockJwt(expiresAt)

        const result = login(token)

        expect(result.success).toBe(true)
        expect(result.expiresIn).toBe("1 hour")
        expect(mockWriteAuth).toHaveBeenCalledWith({
            accessToken: token,
            expiresAt,
        })
    })

    it("should handle token with Bearer prefix", () => {
        const now = Math.floor(Date.now() / 1000)
        const expiresAt = now + 3600
        const rawToken = createMockJwt(expiresAt)
        const token = `Bearer ${rawToken}`

        const result = login(token)

        expect(result.success).toBe(true)
        expect(mockWriteAuth).toHaveBeenCalledWith({
            accessToken: rawToken,
            expiresAt,
        })
    })

    it("should throw on already expired token", () => {
        const now = Math.floor(Date.now() / 1000)
        const expiresAt = now - 100 // Already expired
        const token = createMockJwt(expiresAt)

        expect(() => login(token)).toThrow("Token is already expired")
        expect(mockWriteAuth).not.toHaveBeenCalled()
    })

    it("should return correct time remaining in minutes", () => {
        const now = Math.floor(Date.now() / 1000)
        const expiresAt = now + 300 // 5 minutes
        const token = createMockJwt(expiresAt)

        const result = login(token)

        expect(result.expiresIn).toBe("5 minutes")
    })

    it("should return correct time remaining in hours and minutes", () => {
        const now = Math.floor(Date.now() / 1000)
        const expiresAt = now + 5400 // 1 hour 30 minutes
        const token = createMockJwt(expiresAt)

        const result = login(token)

        expect(result.expiresIn).toBe("1 hour, 30 minutes")
    })

    it("should handle singular minute correctly", () => {
        const now = Math.floor(Date.now() / 1000)
        const expiresAt = now + 60 // 1 minute
        const token = createMockJwt(expiresAt)

        const result = login(token)

        expect(result.expiresIn).toBe("1 minute")
    })

    it("should handle seconds only", () => {
        const now = Math.floor(Date.now() / 1000)
        const expiresAt = now + 45 // 45 seconds
        const token = createMockJwt(expiresAt)

        const result = login(token)

        expect(result.expiresIn).toBe("45 seconds")
    })
})

describe("logout", () => {
    it("should call deleteAuth", () => {
        logout()

        expect(mockDeleteAuth).toHaveBeenCalledOnce()
    })
})

describe("status", () => {
    it("should return not_logged_in when no auth exists", () => {
        mockReadAuth.mockReturnValue(null)

        const result = status()

        expect(result).toEqual({valid: false, reason: "not_logged_in"})
    })

    it("should return expired when token is expired", () => {
        const now = Math.floor(Date.now() / 1000)
        mockReadAuth.mockReturnValue({
            accessToken: "some-token",
            expiresAt: now - 100, // Already expired
        })

        const result = status()

        expect(result).toEqual({valid: false, reason: "expired"})
    })

    it("should return valid with expiration info when token is valid", () => {
        const now = Math.floor(Date.now() / 1000)
        const expiresAt = now + 7200 // 2 hours
        mockReadAuth.mockReturnValue({
            accessToken: "some-token",
            expiresAt,
        })

        const result = status()

        expect(result).toEqual({valid: true, expiresIn: "2 hours", expiresAt})
    })
})

describe("getToken", () => {
    it("should return null when not logged in", () => {
        mockReadAuth.mockReturnValue(null)

        const result = getToken()

        expect(result).toBeNull()
    })

    it("should return null when token is expired", () => {
        const now = Math.floor(Date.now() / 1000)
        mockReadAuth.mockReturnValue({
            accessToken: "expired-token",
            expiresAt: now - 100,
        })

        const result = getToken()

        expect(result).toBeNull()
    })

    it("should return token when valid", () => {
        const now = Math.floor(Date.now() / 1000)
        mockReadAuth.mockReturnValue({
            accessToken: "valid-token",
            expiresAt: now + 3600,
        })

        const result = getToken()

        expect(result).toBe("valid-token")
    })
})

describe("requireAuth", () => {
    it("should throw when not logged in", () => {
        mockReadAuth.mockReturnValue(null)

        expect(() => requireAuth()).toThrow(
            "Not logged in. Please run: yoto login",
        )
    })

    it("should throw specific message when token is expired", () => {
        const now = Math.floor(Date.now() / 1000)
        mockReadAuth.mockReturnValue({
            accessToken: "expired-token",
            expiresAt: now - 100,
        })

        expect(() => requireAuth()).toThrow(
            "Token expired. Please run: yoto login",
        )
    })

    it("should return token when valid", () => {
        const now = Math.floor(Date.now() / 1000)
        mockReadAuth.mockReturnValue({
            accessToken: "valid-token",
            expiresAt: now + 3600,
        })

        const result = requireAuth()

        expect(result).toBe("valid-token")
    })
})
