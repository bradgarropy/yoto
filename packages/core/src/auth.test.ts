import {beforeEach, describe, expect, it, vi} from "vitest"

// Create mock instances that will be returned by constructors
const mockTokenManager = {
    saveTokens: vi.fn(),
    loadTokens: vi.fn(),
    clearTokens: vi.fn(),
    areTokensValid: vi.fn(),
    isTokenExpired: vi.fn(),
    getTimeUntilExpiry: vi.fn(),
}

const mockAuth = {
    initiate: vi.fn(),
    pollForToken: vi.fn(),
    refreshToken: vi.fn(),
}

// Mock the OAuth package with class constructors
vi.mock("@yotoplay/oauth-device-code-flow", () => ({
    TokenManager: class MockTokenManager {
        saveTokens = mockTokenManager.saveTokens
        loadTokens = mockTokenManager.loadTokens
        clearTokens = mockTokenManager.clearTokens
        areTokensValid = mockTokenManager.areTokensValid
        isTokenExpired = mockTokenManager.isTokenExpired
        getTimeUntilExpiry = mockTokenManager.getTimeUntilExpiry
    },
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

// Mock config
vi.mock("./config.js", () => ({
    CONFIG_PATH: "/mock/config/path",
    ensureConfigDir: vi.fn(),
}))

// Import after mocks are set up
import {
    completeLogin,
    getToken,
    initiateLogin,
    logout,
    requireAuth,
    status,
} from "./auth.js"

beforeEach(() => {
    vi.clearAllMocks()
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
    it("should poll for token and save on success", async () => {
        const tokens = {
            accessToken: "test-access-token",
            refreshToken: "test-refresh-token",
            expiresAt: Date.now() / 1000 + 3600,
            tokenType: "Bearer",
        }
        mockAuth.pollForToken.mockResolvedValue({success: true, tokens})
        mockTokenManager.getTimeUntilExpiry.mockReturnValue(3600)

        const result = await completeLogin("device-code", 5)

        expect(mockAuth.pollForToken).toHaveBeenCalledWith(
            "device-code",
            5,
            300000,
        )
        expect(mockTokenManager.saveTokens).toHaveBeenCalledWith(tokens)
        expect(result).toEqual({success: true, expiresIn: "1 hour"})
    })

    it("should return error when polling fails", async () => {
        mockAuth.pollForToken.mockResolvedValue({
            success: false,
            error: "Authorization expired",
        })

        const result = await completeLogin("device-code", 5)

        expect(mockTokenManager.saveTokens).not.toHaveBeenCalled()
        expect(result).toEqual({success: false, error: "Authorization expired"})
    })

    it("should use custom timeout when provided", async () => {
        const tokens = {
            accessToken: "test-token",
            expiresAt: Date.now() / 1000 + 3600,
            tokenType: "Bearer",
        }
        mockAuth.pollForToken.mockResolvedValue({success: true, tokens})
        mockTokenManager.getTimeUntilExpiry.mockReturnValue(3600)

        await completeLogin("device-code", 5, 600000)

        expect(mockAuth.pollForToken).toHaveBeenCalledWith(
            "device-code",
            5,
            600000,
        )
    })
})

describe("logout", () => {
    it("should clear tokens", async () => {
        await logout()

        expect(mockTokenManager.clearTokens).toHaveBeenCalledOnce()
    })
})

describe("status", () => {
    it("should return not_logged_in when no tokens exist", async () => {
        mockTokenManager.loadTokens.mockResolvedValue(null)

        const result = await status()

        expect(result).toEqual({valid: false, reason: "not_logged_in"})
    })

    it("should return valid status when token is not expired", async () => {
        const tokens = {
            accessToken: "test-token",
            expiresAt: Date.now() / 1000 + 7200,
            tokenType: "Bearer",
        }
        mockTokenManager.loadTokens.mockResolvedValue(tokens)
        mockTokenManager.isTokenExpired.mockReturnValue(false)
        mockTokenManager.getTimeUntilExpiry.mockReturnValue(7200)

        const result = await status()

        expect(result).toEqual({
            valid: true,
            expiresIn: "2 hours",
            expiresAt: tokens.expiresAt,
        })
    })

    it("should return expired when token is expired and no refresh token", async () => {
        const tokens = {
            accessToken: "test-token",
            expiresAt: Date.now() / 1000 - 100,
            tokenType: "Bearer",
        }
        mockTokenManager.loadTokens.mockResolvedValue(tokens)
        mockTokenManager.isTokenExpired.mockReturnValue(true)

        const result = await status()

        expect(result).toEqual({valid: false, reason: "expired"})
    })

    it("should try to refresh when expired and refresh token exists", async () => {
        const expiredTokens = {
            accessToken: "expired-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() / 1000 - 100,
            tokenType: "Bearer",
        }
        const newTokens = {
            accessToken: "new-token",
            refreshToken: "new-refresh-token",
            expiresAt: Date.now() / 1000 + 3600,
            tokenType: "Bearer",
        }
        mockTokenManager.loadTokens.mockResolvedValue(expiredTokens)
        mockTokenManager.isTokenExpired.mockReturnValue(true)
        mockAuth.refreshToken.mockResolvedValue({
            success: true,
            tokens: newTokens,
        })
        mockTokenManager.getTimeUntilExpiry.mockReturnValue(3600)

        const result = await status()

        expect(mockAuth.refreshToken).toHaveBeenCalledWith("refresh-token")
        expect(mockTokenManager.saveTokens).toHaveBeenCalledWith(newTokens)
        expect(result).toEqual({
            valid: true,
            expiresIn: "1 hour",
            expiresAt: newTokens.expiresAt,
        })
    })
})

describe("getToken", () => {
    it("should return null when no tokens exist", async () => {
        mockTokenManager.loadTokens.mockResolvedValue(null)

        const result = await getToken()

        expect(result).toBeNull()
    })

    it("should return access token when valid", async () => {
        const tokens = {
            accessToken: "valid-token",
            expiresAt: Date.now() / 1000 + 3600,
            tokenType: "Bearer",
        }
        mockTokenManager.loadTokens.mockResolvedValue(tokens)
        mockTokenManager.isTokenExpired.mockReturnValue(false)
        mockTokenManager.getTimeUntilExpiry.mockReturnValue(3600)

        const result = await getToken()

        expect(result).toBe("valid-token")
    })

    it("should refresh token when about to expire", async () => {
        const nearExpiryTokens = {
            accessToken: "near-expiry-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() / 1000 + 200, // Less than 5 minutes
            tokenType: "Bearer",
        }
        const newTokens = {
            accessToken: "refreshed-token",
            refreshToken: "new-refresh-token",
            expiresAt: Date.now() / 1000 + 3600,
            tokenType: "Bearer",
        }
        mockTokenManager.loadTokens.mockResolvedValue(nearExpiryTokens)
        mockTokenManager.getTimeUntilExpiry.mockReturnValue(200)
        mockAuth.refreshToken.mockResolvedValue({
            success: true,
            tokens: newTokens,
        })

        const result = await getToken()

        expect(mockAuth.refreshToken).toHaveBeenCalledWith("refresh-token")
        expect(result).toBe("refreshed-token")
    })

    it("should return null when expired and refresh fails", async () => {
        const expiredTokens = {
            accessToken: "expired-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() / 1000 - 100,
            tokenType: "Bearer",
        }
        mockTokenManager.loadTokens.mockResolvedValue(expiredTokens)
        mockTokenManager.getTimeUntilExpiry.mockReturnValue(-100)
        mockTokenManager.isTokenExpired.mockReturnValue(true)
        mockAuth.refreshToken.mockResolvedValue({
            success: false,
            error: "Invalid refresh token",
        })

        const result = await getToken()

        expect(result).toBeNull()
    })
})

describe("requireAuth", () => {
    it("should return token when valid", async () => {
        const tokens = {
            accessToken: "valid-token",
            expiresAt: Date.now() / 1000 + 3600,
            tokenType: "Bearer",
        }
        mockTokenManager.loadTokens.mockResolvedValue(tokens)
        mockTokenManager.isTokenExpired.mockReturnValue(false)
        mockTokenManager.getTimeUntilExpiry.mockReturnValue(3600)

        const result = await requireAuth()

        expect(result).toBe("valid-token")
    })

    it("should throw when not logged in", async () => {
        mockTokenManager.loadTokens.mockResolvedValue(null)

        await expect(requireAuth()).rejects.toThrow(
            "Not logged in. Please run: yoto login",
        )
    })

    it("should throw specific message when expired", async () => {
        const expiredTokens = {
            accessToken: "expired-token",
            expiresAt: Date.now() / 1000 - 100,
            tokenType: "Bearer",
        }
        mockTokenManager.loadTokens.mockResolvedValue(expiredTokens)
        mockTokenManager.isTokenExpired.mockReturnValue(true)
        mockTokenManager.getTimeUntilExpiry.mockReturnValue(-100)

        await expect(requireAuth()).rejects.toThrow(
            "Token expired. Please run: yoto login",
        )
    })
})
