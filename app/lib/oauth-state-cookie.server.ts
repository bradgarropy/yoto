import {env} from "cloudflare:workers"
import {createCookie} from "react-router"

import {decrypt, encrypt} from "./encryption.server"

type OAuthState = {
    state: string
    codeVerifier: string
    redirectUri: string
}

const cookieCache = new Map<string, ReturnType<typeof createCookie>>()

function _resetOAuthStateCookie() {
    cookieCache.clear()
}

function getSecret(): string {
    const secret = env.YOTO_AUTH_SECRET
    if (!secret) {
        throw new Error("YOTO_AUTH_SECRET environment variable is required")
    }

    return secret
}

function getOAuthStateCookie(secure: boolean) {
    const secret = getSecret()
    const cacheKey = `${secret}:${secure}`

    let cookie = cookieCache.get(cacheKey)
    if (!cookie) {
        cookie = createCookie("yoto-oauth-state", {
            httpOnly: true,
            secure,
            sameSite: "lax",
            path: "/auth/callback",
            maxAge: 60 * 10,
            secrets: [secret],
        })
        cookieCache.set(cacheKey, cookie)
    }

    return cookie
}

async function getOAuthStateFromCookie(
    request: Request,
): Promise<OAuthState | null> {
    const encrypted = await getOAuthStateCookie(
        new URL(request.url).protocol === "https:",
    ).parse(request.headers.get("Cookie"))

    if (!encrypted) return null

    try {
        return JSON.parse(await decrypt(encrypted, getSecret()))
    } catch {
        return null
    }
}

async function serializeOAuthStateCookie(
    oauthState: OAuthState,
    secure: boolean,
): Promise<string> {
    const encrypted = await encrypt(JSON.stringify(oauthState), getSecret())
    return getOAuthStateCookie(secure).serialize(encrypted)
}

async function clearOAuthStateCookie(secure: boolean): Promise<string> {
    return getOAuthStateCookie(secure).serialize("", {maxAge: 0})
}

export {
    _resetOAuthStateCookie,
    clearOAuthStateCookie,
    getOAuthStateFromCookie,
    serializeOAuthStateCookie,
}
export type {OAuthState}
