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

// Mock the SDK
vi.mock("@yotoplay/yoto-sdk", () => ({
    createYotoSdk: vi.fn(() => ({content: {}, media: {}})),
}))

// Import after mocks are set up
import {
    completeLogin,
    getAuthenticatedSdk,
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
                expiresInSeconds: 3600,
                refreshTokenIssued: true,
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
        expect(console.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.LOGIN.FAILED,
                reason: "access_denied",
                oauthError: "access_denied",
            }),
        )
    })

    it("should handle a rejected token exchange", async () => {
        mockFetch.mockResolvedValue(
            Response.json({error: "invalid_grant"}, {status: 400}),
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
        expect(console.error).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.LOGIN.FAILED,
                stage: "complete",
                reason: "token_exchange_rejected",
                httpStatus: 400,
                oauthError: "invalid_grant",
                durationMs: expect.any(Number),
            }),
        )
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
        mockGetTokensFromCookie.mockResolvedValue(expiredTokens)
        mockFetch.mockResolvedValue(
            Response.json({
                access_token: "new-token",
                refresh_token: "new-refresh-token",
                expires_in: 3605,
                token_type: "Bearer",
            }),
        )

        const result = await status(createMockRequest(), mockEnv)
        const refreshedTokens = mockSerializeAuthCookie.mock.calls[0][0]

        expect(mockFetch).toHaveBeenCalledWith(
            "https://login.yotoplay.com/oauth/token",
            expect.objectContaining({method: "POST"}),
        )
        const requestBody = mockFetch.mock.calls[0][1].body as URLSearchParams
        expect(Object.fromEntries(requestBody)).toEqual({
            grant_type: "refresh_token",
            client_id: "test-yoto-client-id",
            refresh_token: "refresh-token",
        })
        expect(mockSerializeAuthCookie).toHaveBeenCalledWith(
            {
                accessToken: "new-token",
                refreshToken: "new-refresh-token",
                expiresAt: expect.any(Number),
                tokenType: "Bearer",
            },
            mockEnv,
            false,
        )
        expect(result).toEqual({
            valid: true,
            expiresIn: "1 hour",
            expiresAt: refreshedTokens.expiresAt,
            setCookie: "yoto-auth=encrypted; Path=/; HttpOnly",
        })
        expect(console.info).toHaveBeenCalledWith({
            event: EVENT.AUTH.REFRESH.STARTED,
            level: "info",
            trigger: "expired",
        })
        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.REFRESH.COMPLETED,
                level: "info",
                trigger: "expired",
                expiresInSeconds: 3605,
                refreshTokenRotated: true,
                durationMs: expect.any(Number),
            }),
        )

        const logs = JSON.stringify([
            ...vi.mocked(console.info).mock.calls,
            ...vi.mocked(console.warn).mock.calls,
            ...vi.mocked(console.error).mock.calls,
        ])
        expect(logs).not.toContain("refresh-token")
        expect(logs).not.toContain("new-refresh-token")
        expect(logs).not.toContain("new-token")
    })

    it("should warn when token refresh is rejected", async () => {
        const expiredTokens = {
            accessToken: "expired-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() - 100000,
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(expiredTokens)
        mockFetch.mockResolvedValue(
            Response.json({error: "invalid_grant"}, {status: 400}),
        )

        const result = await status(createMockRequest(), mockEnv)

        expect(result).toEqual({valid: false, reason: "expired"})
        expect(console.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.REFRESH.FAILED,
                level: "warn",
                reason: "rejected",
                trigger: "expired",
                httpStatus: 400,
                oauthError: "invalid_grant",
                durationMs: expect.any(Number),
            }),
        )
    })

    it("should reject a refresh response without a rotated refresh token", async () => {
        const expiredTokens = {
            accessToken: "expired-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() - 100000,
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(expiredTokens)
        mockFetch.mockResolvedValue(
            Response.json({
                access_token: "new-token",
                expires_in: 3600,
                token_type: "Bearer",
            }),
        )

        const result = await status(createMockRequest(), mockEnv)

        expect(result).toEqual({valid: false, reason: "expired"})
        expect(mockSerializeAuthCookie).not.toHaveBeenCalled()
        expect(console.error).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.REFRESH.FAILED,
                level: "error",
                reason: "invalid_response",
                trigger: "expired",
                errorName: "InvalidTokenResponseError",
            }),
        )
    })

    it("should distinguish a refresh request failure", async () => {
        mockGetTokensFromCookie.mockResolvedValue({
            accessToken: "expired-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() - 100000,
            tokenType: "Bearer",
        })
        mockFetch.mockRejectedValue(new TypeError("fetch failed"))

        const result = await status(createMockRequest(), mockEnv)

        expect(result).toEqual({valid: false, reason: "expired"})
        expect(console.error).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.REFRESH.FAILED,
                level: "error",
                reason: "request_failed",
                trigger: "expired",
                errorName: "TypeError",
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
        mockGetTokensFromCookie.mockResolvedValue(nearExpiryTokens)
        mockFetch.mockResolvedValue(
            Response.json({
                access_token: "refreshed-token",
                refresh_token: "new-refresh-token",
                expires_in: 3600,
                token_type: "Bearer",
            }),
        )

        const result = await getToken(createMockRequest(), mockEnv)

        expect(result).toEqual({
            token: "refreshed-token",
            setCookie: "yoto-auth=encrypted; Path=/; HttpOnly",
        })
        expect(console.info).toHaveBeenCalledWith({
            event: EVENT.AUTH.REFRESH.STARTED,
            level: "info",
            trigger: "near_expiry",
        })
        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.REFRESH.COMPLETED,
                trigger: "near_expiry",
            }),
        )
    })

    it("should return null when expired and refresh fails", async () => {
        const expiredTokens = {
            accessToken: "expired-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() - 100000, // Expired
            tokenType: "Bearer",
        }
        mockGetTokensFromCookie.mockResolvedValue(expiredTokens)
        mockFetch.mockResolvedValue(
            new Response("invalid_grant", {status: 400}),
        )

        const result = await getToken(createMockRequest(), mockEnv)

        expect(result).toBeNull()
    })
})

describe("getAuthenticatedSdk", () => {
    it("should refresh an expired session only once", async () => {
        mockGetTokensFromCookie.mockResolvedValue({
            accessToken: "expired-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() - 100000,
            tokenType: "Bearer",
        })
        mockFetch.mockResolvedValue(
            Response.json({
                access_token: "refreshed-token",
                refresh_token: "rotated-refresh-token",
                expires_in: 3600,
                token_type: "Bearer",
            }),
        )

        const result = await getAuthenticatedSdk(createMockRequest(), mockEnv)

        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(result).toEqual({
            sdk: {content: {}, media: {}},
            setCookie: "yoto-auth=encrypted; Path=/; HttpOnly",
        })
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
