import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EVENT} from "~/lib/telemetry.server"
import {createMockEnv} from "~/tests/mocks"

vi.mock("cloudflare:workers", () => ({
    env: {
        YOTO_AUTH_SECRET: "test-auth-secret",
        YOTO_CLIENT_ID: "test-yoto-client-id",
    },
}))

// Mock the auth-cookie module
const mockGetTokensFromCookie = vi.fn()
const mockSerializeAuthCookie = vi.fn()
const mockClearAuthCookie = vi.fn()
const mockSerializeOAuthStateCookie = vi.fn()
const mockGetOAuthStateFromCookie = vi.fn()
const mockClearOAuthStateCookie = vi.fn()
const mockFetch = vi.fn()

vi.mock("./auth-cookie.server", () => ({
    getTokensFromCookie: (...args: unknown[]) =>
        mockGetTokensFromCookie(...args),
    serializeAuthCookie: (...args: unknown[]) =>
        mockSerializeAuthCookie(...args),
    clearAuthCookie: (...args: unknown[]) => mockClearAuthCookie(...args),
}))

vi.mock("./oauth-state-cookie.server", () => ({
    serializeOAuthStateCookie: (...args: unknown[]) =>
        mockSerializeOAuthStateCookie(...args),
    getOAuthStateFromCookie: (...args: unknown[]) =>
        mockGetOAuthStateFromCookie(...args),
    clearOAuthStateCookie: (...args: unknown[]) =>
        mockClearOAuthStateCookie(...args),
}))

vi.mock("pkce-challenge", () => ({
    default: vi.fn(async () => ({
        code_verifier: "test-code-verifier",
        code_challenge: "test-code-challenge",
        code_challenge_method: "S256",
    })),
}))

// Create mock instances that will be returned by constructors
const mockAuth = {
    pollForToken: vi.fn(),
    refreshToken: vi.fn(),
}
const mockDeviceCodeAuthConstructor = vi.fn()

// Mock the OAuth package with class constructors
vi.mock("@yotoplay/oauth-device-code-flow", () => ({
    DeviceCodeAuth: class MockDeviceCodeAuth {
        constructor(config: unknown) {
            mockDeviceCodeAuthConstructor(config)
        }

        pollForToken = mockAuth.pollForToken
        refreshToken = mockAuth.refreshToken
    },
}))

// Mock the SDK
vi.mock("@yotoplay/yoto-sdk", () => ({
    createYotoSdk: vi.fn(() => ({content: {}, media: {}})),
}))

// Import after mocks are set up
import {
    completeLogin,
    getToken,
    initiateLogin,
    logout,
    requireAuthCore,
    status,
} from "./auth.server"

// Helper to create a mock Request
const createMockRequest = () => new Request("http://localhost/")

// Mock env object
const mockEnv = createMockEnv()

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", mockFetch)
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockSerializeAuthCookie.mockResolvedValue(
        "yoto-auth=encrypted; Path=/; HttpOnly",
    )
    mockClearAuthCookie.mockResolvedValue(
        "yoto-auth=; Max-Age=0; Path=/; HttpOnly",
    )
    mockSerializeOAuthStateCookie.mockResolvedValue(
        "yoto-oauth-state=encrypted; Path=/auth/callback; HttpOnly",
    )
    mockGetOAuthStateFromCookie.mockResolvedValue({
        state: "test-state",
        codeVerifier: "test-code-verifier",
        redirectUri: "http://localhost:3000/auth/callback",
    })
    mockClearOAuthStateCookie.mockResolvedValue(
        "yoto-oauth-state=; Max-Age=0; Path=/auth/callback; HttpOnly",
    )
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe("initiateLogin", () => {
    it("should store the verifier and redirect to Yoto", async () => {
        const request = new Request("http://localhost:3000/login", {
            method: "POST",
        })

        const response = await initiateLogin(request)
        const location = new URL(response.headers.get("Location") ?? "")
        const state = location.searchParams.get("state")

        expect(response.status).toBe(302)
        expect(location.origin + location.pathname).toBe(
            "https://login.yotoplay.com/authorize",
        )
        expect(Object.fromEntries(location.searchParams)).toEqual({
            audience: "https://api.yotoplay.com",
            scope: "user:content:manage offline_access",
            response_type: "code",
            client_id: "test-yoto-client-id",
            redirect_uri: "http://localhost:3000/auth/callback",
            state,
            code_challenge: "test-code-challenge",
            code_challenge_method: "S256",
        })
        expect(state).toEqual(expect.any(String))
        expect(mockSerializeOAuthStateCookie).toHaveBeenCalledWith(
            {
                state,
                codeVerifier: "test-code-verifier",
                redirectUri: "http://localhost:3000/auth/callback",
            },
            false,
        )
        expect(response.headers.get("Set-Cookie")).toBe(
            "yoto-oauth-state=encrypted; Path=/auth/callback; HttpOnly",
        )
        expect(console.info).toHaveBeenCalledWith({
            event: EVENT.AUTH.LOGIN.STARTED,
            level: "info",
        })
    })

    it("should use secure state cookies in production", async () => {
        await initiateLogin(
            new Request("https://yoto.bradgarropy.com/login", {method: "POST"}),
        )

        expect(mockSerializeOAuthStateCookie).toHaveBeenCalledWith(
            expect.objectContaining({
                redirectUri: "https://yoto.bradgarropy.com/auth/callback",
            }),
            true,
        )
    })
})

describe("completeLogin", () => {
    it("should exchange the code, set tokens, and clear OAuth state", async () => {
        mockFetch.mockResolvedValue(
            Response.json({
                access_token: "test-access-token",
                refresh_token: "test-refresh-token",
                expires_in: 3600,
                token_type: "Bearer",
            }),
        )

        const response = await completeLogin(
            new Request(
                "http://localhost:3000/auth/callback?code=test-code&state=test-state",
            ),
        )

        expect(mockGetOAuthStateFromCookie).toHaveBeenCalled()
        expect(mockFetch).toHaveBeenCalledWith(
            "https://login.yotoplay.com/oauth/token",
            expect.objectContaining({
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }),
        )
        const requestBody = mockFetch.mock.calls[0][1].body as URLSearchParams
        expect(Object.fromEntries(requestBody)).toEqual({
            grant_type: "authorization_code",
            client_id: "test-yoto-client-id",
            code_verifier: "test-code-verifier",
            code: "test-code",
            redirect_uri: "http://localhost:3000/auth/callback",
        })
        expect(mockSerializeAuthCookie).toHaveBeenCalledWith(
            {
                accessToken: "test-access-token",
                refreshToken: "test-refresh-token",
                expiresAt: expect.any(Number),
                tokenType: "Bearer",
            },
            expect.objectContaining({YOTO_CLIENT_ID: "test-yoto-client-id"}),
            false,
        )
        expect(mockClearOAuthStateCookie).toHaveBeenCalledWith(false)
        expect(response.status).toBe(302)
        expect(response.headers.get("Location")).toBe("/cards")
        expect(response.headers.get("Set-Cookie")).toContain(
            "yoto-auth=encrypted",
        )
        expect(response.headers.get("Set-Cookie")).toContain(
            "yoto-oauth-state=",
        )
        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.LOGIN.COMPLETED,
                level: "info",
                durationMs: expect.any(Number),
            }),
        )
    })

    it("should reject a mismatched state without exchanging the code", async () => {
        const response = await completeLogin(
            new Request(
                "http://localhost:3000/auth/callback?code=test-code&state=wrong-state",
            ),
        )

        expect(mockFetch).not.toHaveBeenCalled()
        expect(mockSerializeAuthCookie).not.toHaveBeenCalled()
        expect(response.headers.get("Location")).toBe(
            "/login?error=state_mismatch",
        )
        expect(console.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.LOGIN.FAILED,
                level: "warn",
                stage: "complete",
                reason: "state_mismatch",
                durationMs: expect.any(Number),
            }),
        )
    })

    it("should handle an expired state cookie", async () => {
        mockGetOAuthStateFromCookie.mockResolvedValue(null)

        const response = await completeLogin(
            new Request(
                "http://localhost:3000/auth/callback?code=test-code&state=test-state",
            ),
        )

        expect(mockFetch).not.toHaveBeenCalled()
        expect(response.headers.get("Location")).toBe(
            "/login?error=expired_state",
        )
    })

    it("should handle access being denied by Yoto", async () => {
        const response = await completeLogin(
            new Request(
                "http://localhost:3000/auth/callback?error=access_denied&state=test-state",
            ),
        )

        expect(mockFetch).not.toHaveBeenCalled()
        expect(response.headers.get("Location")).toBe(
            "/login?error=access_denied",
        )
    })

    it("should handle a rejected token exchange", async () => {
        mockFetch.mockResolvedValue(
            new Response("invalid_grant", {status: 400}),
        )

        const response = await completeLogin(
            new Request(
                "http://localhost:3000/auth/callback?code=test-code&state=test-state",
            ),
        )

        expect(response.headers.get("Location")).toBe(
            "/login?error=token_exchange_failed",
        )
        expect(mockSerializeAuthCookie).not.toHaveBeenCalled()
    })
})

describe("logout", () => {
    it("should return clear cookie header", async () => {
        const result = await logout(createMockRequest(), mockEnv)

        expect(mockClearAuthCookie).toHaveBeenCalledWith(mockEnv, false)
        expect(result).toBe("yoto-auth=; Max-Age=0; Path=/; HttpOnly")
        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.LOGOUT.COMPLETED,
                level: "info",
                durationMs: expect.any(Number),
            }),
        )
    })

    it("should log and rethrow when clearing the cookie fails", async () => {
        mockClearAuthCookie.mockRejectedValue(new Error("Cookie failure"))

        await expect(logout(createMockRequest(), mockEnv)).rejects.toThrow(
            "Cookie failure",
        )
        expect(console.error).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.LOGOUT.FAILED,
                level: "error",
                reason: "unexpected_error",
                errorName: "Error",
                durationMs: expect.any(Number),
            }),
        )
    })
})

describe("status", () => {
    it("should return not_logged_in when no tokens exist", async () => {
        mockGetTokensFromCookie.mockResolvedValue(null)

        const result = await status(createMockRequest(), mockEnv)

        expect(result).toEqual({valid: false, reason: "not_logged_in"})
    })

    it("should return valid status when token is not expired", async () => {
        const tokens = {
            accessToken: "test-token",
            expiresAt: Date.now() + 7200000 + 5000, // 2 hours + 5s buffer from now in ms
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(tokens)

        const result = await status(createMockRequest(), mockEnv)

        expect(result).toEqual({
            valid: true,
            expiresIn: "2 hours",
            expiresAt: tokens.expiresAt,
        })
    })

    it("should return expired when token is expired and no refresh token", async () => {
        const tokens = {
            accessToken: "test-token",
            expiresAt: Date.now() - 100000, // Expired
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(tokens)

        const result = await status(createMockRequest(), mockEnv)

        expect(result).toEqual({valid: false, reason: "expired"})
    })

    it("should try to refresh when expired and refresh token exists", async () => {
        const expiredTokens = {
            accessToken: "expired-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() - 100000, // Expired
            tokenType: "Bearer",
        }
        const newTokens = {
            accessToken: "new-token",
            refreshToken: "new-refresh-token",
            expiresAt: Date.now() + 3600000 + 5000, // 1 hour + 5s buffer
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(expiredTokens)
        mockAuth.refreshToken.mockResolvedValue({
            success: true,
            tokens: newTokens,
        })

        const result = await status(createMockRequest(), mockEnv)

        expect(mockAuth.refreshToken).toHaveBeenCalledWith("refresh-token")
        expect(mockSerializeAuthCookie).toHaveBeenCalledWith(
            newTokens,
            mockEnv,
            false,
        )
        expect(result).toEqual({
            valid: true,
            expiresIn: "1 hour",
            expiresAt: newTokens.expiresAt,
            setCookie: "yoto-auth=encrypted; Path=/; HttpOnly",
        })
        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.REFRESH.COMPLETED,
                level: "info",
                durationMs: expect.any(Number),
            }),
        )
    })

    it("should warn when token refresh is rejected", async () => {
        const expiredTokens = {
            accessToken: "expired-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() - 100000,
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(expiredTokens)
        mockAuth.refreshToken.mockResolvedValue({
            success: false,
            error: "Invalid refresh token",
        })

        const result = await status(createMockRequest(), mockEnv)

        expect(result).toEqual({valid: false, reason: "expired"})
        expect(console.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.REFRESH.FAILED,
                level: "warn",
                reason: "rejected",
                durationMs: expect.any(Number),
            }),
        )
    })
})

describe("getToken", () => {
    it("should return null when no tokens exist", async () => {
        mockGetTokensFromCookie.mockResolvedValue(null)

        const result = await getToken(createMockRequest(), mockEnv)

        expect(result).toBeNull()
    })

    it("should return access token when valid", async () => {
        const tokens = {
            accessToken: "valid-token",
            expiresAt: Date.now() + 3600000,
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(tokens)

        const result = await getToken(createMockRequest(), mockEnv)

        expect(result).toEqual({token: "valid-token"})
    })

    it("should refresh token when about to expire", async () => {
        const nearExpiryTokens = {
            accessToken: "near-expiry-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() + 200000, // Less than 5 minutes (300s)
            tokenType: "Bearer",
        }
        const newTokens = {
            accessToken: "refreshed-token",
            refreshToken: "new-refresh-token",
            expiresAt: Date.now() + 3600000,
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(nearExpiryTokens)
        mockAuth.refreshToken.mockResolvedValue({
            success: true,
            tokens: newTokens,
        })

        const result = await getToken(createMockRequest(), mockEnv)

        expect(mockAuth.refreshToken).toHaveBeenCalledWith("refresh-token")
        expect(result).toEqual({
            token: "refreshed-token",
            setCookie: "yoto-auth=encrypted; Path=/; HttpOnly",
        })
    })

    it("should return null when expired and refresh fails", async () => {
        const expiredTokens = {
            accessToken: "expired-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() - 100000, // Expired
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(expiredTokens)
        mockAuth.refreshToken.mockResolvedValue({
            success: false,
            error: "Invalid refresh token",
        })

        const result = await getToken(createMockRequest(), mockEnv)

        expect(result).toBeNull()
    })
})

describe("requireAuthCore", () => {
    it("should return token when valid", async () => {
        const tokens = {
            accessToken: "valid-token",
            expiresAt: Date.now() + 3600000,
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(tokens)

        const result = await requireAuthCore(createMockRequest(), mockEnv)

        expect(result).toEqual({token: "valid-token"})
    })

    it("should throw when not logged in", async () => {
        mockGetTokensFromCookie.mockResolvedValue(null)

        await expect(
            requireAuthCore(createMockRequest(), mockEnv),
        ).rejects.toThrow("Not logged in. Please log in.")
    })

    it("should throw specific message when expired", async () => {
        const expiredTokens = {
            accessToken: "expired-token",
            expiresAt: Date.now() - 100000, // Expired
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(expiredTokens)

        await expect(
            requireAuthCore(createMockRequest(), mockEnv),
        ).rejects.toThrow("Token expired. Please log in again.")
    })
})
