import {beforeEach, describe, expect, it, vi} from "vitest"

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
const mockEnv = {
    YOTO_AUTH_SECRET: "test-secret-key-for-testing",
    SANDBOX: {} as Env["SANDBOX"],
}

beforeEach(() => {
    vi.clearAllMocks()
    mockSerializeAuthCookie.mockResolvedValue(
        "yoto-auth=encrypted; Path=/; HttpOnly",
    )
    mockClearAuthCookie.mockResolvedValue(
        "yoto-auth=; Max-Age=0; Path=/; HttpOnly",
    )
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

        expect(mockAuth.initiate).toHaveBeenCalledOnce()
        expect(result).toEqual(deviceCodeResult)
    })

    it("should return error result when initiate fails", async () => {
        const errorResult = {
            success: false,
            error: "Failed to initiate device code flow",
        }
        mockAuth.initiate.mockResolvedValue(errorResult)

        const result = await initiateLogin()

        expect(result).toEqual(errorResult)
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

        const result = await completeLogin(mockEnv, "device-code", 5)

        expect(mockAuth.pollForToken).toHaveBeenCalledWith(
            "device-code",
            5,
            300000,
        )
        expect(mockSerializeAuthCookie).toHaveBeenCalledWith(tokens, mockEnv)
        expect(result).toEqual({
            success: true,
            expiresIn: "1 hour",
            setCookie: "yoto-auth=encrypted; Path=/; HttpOnly",
        })
    })

    it("should return error when polling fails", async () => {
        mockAuth.pollForToken.mockResolvedValue({
            success: false,
            error: "Authorization expired",
        })

        const result = await completeLogin(mockEnv, "device-code", 5)

        expect(mockSerializeAuthCookie).not.toHaveBeenCalled()
        expect(result).toEqual({success: false, error: "Authorization expired"})
    })

    it("should use custom timeout when provided", async () => {
        const tokens = {
            accessToken: "test-token",
            expiresAt: Date.now() + 3600000,
            tokenType: "Bearer",
        }
        mockAuth.pollForToken.mockResolvedValue({success: true, tokens})

        await completeLogin(mockEnv, "device-code", 5, 600000)

        expect(mockAuth.pollForToken).toHaveBeenCalledWith(
            "device-code",
            5,
            600000,
        )
    })
})

describe("logout", () => {
    it("should return clear cookie header", async () => {
        const result = await logout(mockEnv)

        expect(mockClearAuthCookie).toHaveBeenCalledWith(mockEnv)
        expect(result).toBe("yoto-auth=; Max-Age=0; Path=/; HttpOnly")
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
        expect(mockSerializeAuthCookie).toHaveBeenCalledWith(newTokens, mockEnv)
        expect(result).toEqual({
            valid: true,
            expiresIn: "1 hour",
            expiresAt: newTokens.expiresAt,
            setCookie: "yoto-auth=encrypted; Path=/; HttpOnly",
        })
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
