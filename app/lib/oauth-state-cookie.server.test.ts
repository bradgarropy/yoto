import {beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("cloudflare:workers", () => ({
    env: {YOTO_AUTH_SECRET: "test-auth-secret"},
}))

import {
    _resetOAuthStateCookie,
    clearOAuthStateCookie,
    getOAuthStateFromCookie,
    type OAuthState,
    serializeOAuthStateCookie,
} from "./oauth-state-cookie.server"

const oauthState: OAuthState = {
    state: "test-state",
    codeVerifier: "test-code-verifier",
    redirectUri: "http://localhost:3000/auth/callback",
}

describe("oauth-state-cookie", () => {
    beforeEach(() => {
        _resetOAuthStateCookie()
    })

    it("stores encrypted PKCE state in a short-lived callback cookie", async () => {
        const cookie = await serializeOAuthStateCookie(oauthState, false)

        expect(cookie).toContain("yoto-oauth-state=")
        expect(cookie).toContain("Max-Age=600")
        expect(cookie).toContain("Path=/auth/callback")
        expect(cookie).toContain("HttpOnly")
        expect(cookie).toContain("SameSite=Lax")
        expect(cookie).not.toContain("Secure")
        expect(cookie).not.toContain(oauthState.codeVerifier)
    })

    it("roundtrips the stored OAuth state", async () => {
        const cookie = await serializeOAuthStateCookie(oauthState, false)
        const request = new Request("http://localhost:3000/auth/callback", {
            headers: {Cookie: cookie.split(";")[0]},
        })

        await expect(getOAuthStateFromCookie(request)).resolves.toEqual(
            oauthState,
        )
    })

    it("rejects a corrupted cookie", async () => {
        const request = new Request("http://localhost:3000/auth/callback", {
            headers: {Cookie: "yoto-oauth-state=corrupted"},
        })

        await expect(getOAuthStateFromCookie(request)).resolves.toBeNull()
    })

    it("clears the callback cookie", async () => {
        const cookie = await clearOAuthStateCookie(true)

        expect(cookie).toContain("yoto-oauth-state=")
        expect(cookie).toContain("Max-Age=0")
        expect(cookie).toContain("Path=/auth/callback")
        expect(cookie).toContain("Secure")
    })
})
