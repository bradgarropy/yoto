import type {StoredTokens} from "@yotoplay/oauth-device-code-flow"
import {createCookie} from "react-router"

// --- Web Crypto Encryption (AES-256-GCM) ---

async function deriveKey(secret: string): Promise<CryptoKey> {
    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(secret),
    )
    return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ])
}

async function encrypt(data: string, secret: string): Promise<string> {
    const key = await deriveKey(secret)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoded = new TextEncoder().encode(data)
    const ciphertext = await crypto.subtle.encrypt(
        {name: "AES-GCM", iv},
        key,
        encoded,
    )

    // Combine IV + ciphertext, then base64
    const combined = new Uint8Array(iv.length + ciphertext.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(ciphertext), iv.length)
    return btoa(String.fromCharCode(...combined))
}

async function decrypt(encrypted: string, secret: string): Promise<string> {
    const key = await deriveKey(secret)
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0))
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)
    const decrypted = await crypto.subtle.decrypt(
        {name: "AES-GCM", iv},
        key,
        ciphertext,
    )
    return new TextDecoder().decode(decrypted)
}

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
