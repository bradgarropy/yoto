import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EVENT} from "~/lib/telemetry.server"
import {createMockEnv} from "~/tests/mocks"

// Mock the auth-cookie module
const mockGetTokensFromCookie = vi.fn()
const mockSerializeAuthCookie = vi.fn()
const mockClearAuthCookie = vi.fn()

vi.mock("./auth-cookie.server", () => ({
    getTokensFromCookie: (...args: unknown[]) =>
        mockGetTokensFromCookie(...args),
    serializeAuthCookie: (...args: unknown[]) =>
        mockSerializeAuthCookie(...args),
    clearAuthCookie: (...args: unknown[]) => mockClearAuthCookie(...args),
}))

// Create mock instances that will be returned by constructors
const mockAuth = {
    initiate: vi.fn(),
    pollForToken: vi.fn(),
    refreshToken: vi.fn(),
}

// Mock the OAuth package with class constructors
vi.mock("@yotoplay/oauth-device-code-flow", () => ({
    DeviceCodeAuth: class MockDeviceCodeAuth {
        initiate = mockAuth.initiate
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
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockSerializeAuthCookie.mockResolvedValue(
        "yoto-auth=encrypted; Path=/; HttpOnly",
    )
    mockClearAuthCookie.mockResolvedValue(
        "yoto-auth=; Max-Age=0; Path=/; HttpOnly",
    )
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("initiateLogin", () => {
    it("should call auth.initiate and return device code info", async () => {
        const deviceCodeResult = {
            success: true,
            deviceCode: "test-device-code",
            userCode: "ABCD-EFGH",
            verificationUri: "https://login.yotoplay.com/activate",
            interval: 5,
            expiresIn: 300,
        }
        mockAuth.initiate.mockResolvedValue(deviceCodeResult)

        const result = await initiateLogin()

        expect(mockAuth.initiate).toHaveBeenCalledWith("offline_access")
        expect(result).toEqual(deviceCodeResult)
        expect(console.info).toHaveBeenCalledWith({
            event: EVENT.AUTH.LOGIN.STARTED,
            level: "info",
        })
    })

    it("should return error result when initiate fails", async () => {
        const errorResult = {
            success: false,
            error: "Failed to initiate device code flow",
        }
        mockAuth.initiate.mockResolvedValue(errorResult)

        const result = await initiateLogin()

        expect(result).toEqual(errorResult)
        expect(console.error).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.LOGIN.FAILED,
                level: "error",
                stage: "initiate",
                reason: "provider_error",
                durationMs: expect.any(Number),
            }),
        )
    })
})

describe("completeLogin", () => {
    it("should poll for token and return setCookie on success", async () => {
        const tokens = {
            accessToken: "test-access-token",
            refreshToken: "test-refresh-token",
            expiresAt: Date.now() + 3600000 + 5000, // 1 hour + 5s buffer from now in ms
            tokenType: "Bearer",
        }
        mockAuth.pollForToken.mockResolvedValue({success: true, tokens})

        const result = await completeLogin(
            createMockRequest(),
            mockEnv,
            "device-code",
            5,
        )

        expect(mockAuth.pollForToken).toHaveBeenCalledWith(
            "device-code",
            5,
            300000,
        )
        expect(mockSerializeAuthCookie).toHaveBeenCalledWith(
            tokens,
            mockEnv,
            false,
        )
        expect(result).toEqual({
            success: true,
            expiresIn: "1 hour",
            setCookie: "yoto-auth=encrypted; Path=/; HttpOnly",
        })
        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.LOGIN.COMPLETED,
                level: "info",
                durationMs: expect.any(Number),
            }),
        )
    })

    it("should return error when polling fails", async () => {
        mockAuth.pollForToken.mockResolvedValue({
            success: false,
            error: "Authorization expired",
        })

        const result = await completeLogin(
            createMockRequest(),
            mockEnv,
            "device-code",
            5,
        )

        expect(mockSerializeAuthCookie).not.toHaveBeenCalled()
        expect(result).toEqual({success: false, error: "Authorization expired"})
        expect(console.error).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.LOGIN.FAILED,
                level: "error",
                stage: "complete",
                reason: "provider_error",
                durationMs: expect.any(Number),
            }),
        )
    })

    it("should warn when access is denied", async () => {
        mockAuth.pollForToken.mockResolvedValue({
            success: false,
            error: "access_denied",
        })

        const result = await completeLogin(
            createMockRequest(),
            mockEnv,
            "device-code",
            5,
        )

        expect(result).toEqual({success: false, error: "access_denied"})
        expect(console.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                event: EVENT.AUTH.LOGIN.FAILED,
                level: "warn",
                stage: "complete",
                reason: "access_denied",
                durationMs: expect.any(Number),
            }),
        )
    })

    it("should use custom timeout when provided", async () => {
        const tokens = {
            accessToken: "test-token",
            expiresAt: Date.now() + 3600000,
            tokenType: "Bearer",
        }
        mockAuth.pollForToken.mockResolvedValue({success: true, tokens})

        await completeLogin(
            createMockRequest(),
            mockEnv,
            "device-code",
            5,
            600000,
        )

        expect(mockAuth.pollForToken).toHaveBeenCalledWith(
            "device-code",
            5,
            600000,
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
