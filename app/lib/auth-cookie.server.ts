import type {StoredTokens} from "@yotoplay/oauth-device-code-flow"
import {createCookie} from "react-router"

import {decrypt, encrypt} from "./encryption.server"

// --- Cookie Setup ---

function getSecret(env: Env): string {
    const secret = env.YOTO_AUTH_SECRET
    if (!secret)
        throw new Error("YOTO_AUTH_SECRET environment variable is required")
    return secret
}

// Cache cookies by secret to avoid recreating them
const cookieCache = new Map<string, ReturnType<typeof createCookie>>()

function getAuthCookie(env: Env, secure: boolean) {
    const secret = getSecret(env)
    const cacheKey = `${secret}:${secure}`

    let cookie = cookieCache.get(cacheKey)
    if (!cookie) {
        cookie = createCookie("yoto-auth", {
            httpOnly: true,
            secure,
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 30, // 30 days
            secrets: [secret],
        })
        cookieCache.set(cacheKey, cookie)
    }
    return cookie
}

// For testing: reset the cached cookies
export function _resetAuthCookie() {
    cookieCache.clear()
}

// --- Public API ---

export async function getTokensFromCookie(
    request: Request,
    env: Env,
): Promise<StoredTokens | null> {
    const cookieHeader = request.headers.get("Cookie")
    const encrypted = await getAuthCookie(env, true).parse(cookieHeader)
    if (!encrypted) return null

    try {
        const json = await decrypt(encrypted, getSecret(env))
        return JSON.parse(json)
    } catch {
        return null // Decryption failed
    }
}

export async function serializeAuthCookie(
    tokens: StoredTokens,
    env: Env,
    secure = true,
): Promise<string> {
    const json = JSON.stringify(tokens)
    const encrypted = await encrypt(json, getSecret(env))
    return getAuthCookie(env, secure).serialize(encrypted)
}

export async function clearAuthCookie(
    env: Env,
    secure = true,
): Promise<string> {
    return getAuthCookie(env, secure).serialize("", {maxAge: 0})
}
