import type {StoredTokens} from "@yotoplay/oauth-device-code-flow"
import {beforeEach, describe, expect, it} from "vitest"

// Import module
import {
    _resetAuthCookie,
    clearAuthCookie,
    getTokensFromCookie,
    serializeAuthCookie,
} from "./auth-cookie.server"

// Mock env object
const mockEnv = {
    YOTO_AUTH_SECRET: "test-secret-key-for-testing",
}

const mockTokens: StoredTokens = {
    accessToken: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test-access-token",
    refreshToken: "v1.test-refresh-token",
    expiresAt: Date.now() + 3600000, // 1 hour from now
    tokenType: "Bearer",
}

describe("auth-cookie", () => {
    beforeEach(() => {
        _resetAuthCookie() // Reset cached cookie between tests
    })

    describe("serializeAuthCookie", () => {
        it("should serialize tokens to a cookie string", async () => {
            const cookieString = await serializeAuthCookie(mockTokens, mockEnv)

            expect(cookieString).toContain("yoto-auth=")
            expect(cookieString).toContain("Path=/")
            expect(cookieString).toContain("HttpOnly")
            expect(cookieString).toContain("SameSite=Lax")
        })

        it("should produce different encrypted values for same input (random IV)", async () => {
            const cookie1 = await serializeAuthCookie(mockTokens, mockEnv)
            const cookie2 = await serializeAuthCookie(mockTokens, mockEnv)

            // Extract the encrypted value from the cookie string
            const getValue = (cookie: string) =>
                cookie.split(";")[0].split("=")[1]

            // The encrypted values should be different due to random IV
            expect(getValue(cookie1)).not.toBe(getValue(cookie2))
        })

        it("should include Max-Age for 30 days", async () => {
            const cookieString = await serializeAuthCookie(mockTokens, mockEnv)

            // 30 days in seconds = 60 * 60 * 24 * 30 = 2592000
            expect(cookieString).toContain("Max-Age=2592000")
        })
    })

    describe("getTokensFromCookie", () => {
        it("should return null when no cookie header is present", async () => {
            const request = new Request("http://localhost/", {
                headers: {},
            })

            const result = await getTokensFromCookie(request, mockEnv)

            expect(result).toBeNull()
        })

        it("should return null when cookie is empty", async () => {
            const request = new Request("http://localhost/", {
                headers: {
                    Cookie: "",
                },
            })

            const result = await getTokensFromCookie(request, mockEnv)

            expect(result).toBeNull()
        })

        it("should return null when yoto-auth cookie is not present", async () => {
            const request = new Request("http://localhost/", {
                headers: {
                    Cookie: "other-cookie=some-value",
                },
            })

            const result = await getTokensFromCookie(request, mockEnv)

            expect(result).toBeNull()
        })

        it("should return null for invalid/corrupted cookie data", async () => {
            const request = new Request("http://localhost/", {
                headers: {
                    Cookie: "yoto-auth=invalid-encrypted-data",
                },
            })

            const result = await getTokensFromCookie(request, mockEnv)

            expect(result).toBeNull()
        })

        it("should roundtrip tokens through serialize and parse", async () => {
            // Serialize the tokens
            const cookieString = await serializeAuthCookie(mockTokens, mockEnv)

            // Extract just the cookie value for the Cookie header
            // The Set-Cookie header format is: name=value; attributes...
            // We need to send just name=value in the Cookie header
            const cookieValue = cookieString.split(";")[0]

            const request = new Request("http://localhost/", {
                headers: {
                    Cookie: cookieValue,
                },
            })

            const result = await getTokensFromCookie(request, mockEnv)

            expect(result).toEqual(mockTokens)
        })

        it("should handle tokens without refreshToken", async () => {
            const tokensWithoutRefresh: StoredTokens = {
                accessToken: "test-access-token",
                expiresAt: Date.now() + 3600000,
                tokenType: "Bearer",
            }

            const cookieString = await serializeAuthCookie(
                tokensWithoutRefresh,
                mockEnv,
            )
            const cookieValue = cookieString.split(";")[0]

            const request = new Request("http://localhost/", {
                headers: {
                    Cookie: cookieValue,
                },
            })

            const result = await getTokensFromCookie(request, mockEnv)

            expect(result).toEqual(tokensWithoutRefresh)
        })

        it("should handle large tokens (realistic JWT size)", async () => {
            const largeTokens: StoredTokens = {
                accessToken:
                    "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9." + "a".repeat(1400),
                refreshToken: "v1." + "b".repeat(100),
                expiresAt: 1771039377074,
                tokenType: "Bearer",
            }

            const cookieString = await serializeAuthCookie(largeTokens, mockEnv)
            const cookieValue = cookieString.split(";")[0]

            const request = new Request("http://localhost/", {
                headers: {
                    Cookie: cookieValue,
                },
            })

            const result = await getTokensFromCookie(request, mockEnv)

            expect(result).toEqual(largeTokens)
        })
    })

    describe("clearAuthCookie", () => {
        it("should return a cookie string that clears the cookie", async () => {
            const cookieString = await clearAuthCookie(mockEnv)

            expect(cookieString).toContain("yoto-auth=")
            expect(cookieString).toContain("Max-Age=0")
        })

        it("should maintain HttpOnly and other security attributes", async () => {
            const cookieString = await clearAuthCookie(mockEnv)

            expect(cookieString).toContain("HttpOnly")
            expect(cookieString).toContain("Path=/")
            expect(cookieString).toContain("SameSite=Lax")
        })
    })

    describe("encryption security", () => {
        it("should not expose token data in the cookie value", async () => {
            const cookieString = await serializeAuthCookie(mockTokens, mockEnv)

            // The access token should not appear in plain text
            expect(cookieString).not.toContain(mockTokens.accessToken)
            expect(cookieString).not.toContain(mockTokens.refreshToken)
        })

        it("should fail to decrypt with wrong secret", async () => {
            // Serialize with current secret
            const cookieString = await serializeAuthCookie(mockTokens, mockEnv)
            const cookieValue = cookieString.split(";")[0]

            // Create a different env with wrong secret
            const wrongEnv = {YOTO_AUTH_SECRET: "different-secret-key"}

            const request = new Request("http://localhost/", {
                headers: {
                    Cookie: cookieValue,
                },
            })

            // The cookie should fail to parse/decrypt with wrong secret
            const result = await getTokensFromCookie(request, wrongEnv)

            // Result should be null because either signature verification
            // or decryption failed
            expect(result).toBeNull()
        })
    })

    describe("error handling", () => {
        it("should verify behavior with valid secret", async () => {
            // For this test, we verify the behavior is correct with a valid secret
            const result = await serializeAuthCookie(mockTokens, mockEnv)
            expect(result).toBeTruthy()
        })
    })
})

describe("cookie attributes in workers", () => {
    it("should always set Secure flag for Workers environment", async () => {
        // In Cloudflare Workers, HTTPS is always enforced,
        // so Secure should always be present
        const cookieString = await serializeAuthCookie(mockTokens, mockEnv)

        expect(cookieString).toContain("Secure")
    })
})
