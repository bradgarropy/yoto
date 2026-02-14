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

function getSecret(): string {
    const secret = process.env.YOTO_AUTH_SECRET
    if (!secret)
        throw new Error("YOTO_AUTH_SECRET environment variable is required")
    return secret
}

// Lazily create the cookie to avoid reading env at module load time
let _authCookie: ReturnType<typeof createCookie> | null = null

function getAuthCookie() {
    if (!_authCookie) {
        _authCookie = createCookie("yoto-auth", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: 60 * 60 * 24 * 30, // 30 days
            secrets: [getSecret()],
        })
    }
    return _authCookie
}

// For testing: reset the cached cookie
export function _resetAuthCookie() {
    _authCookie = null
}

// --- Public API ---

export async function getTokensFromCookie(
    request: Request,
): Promise<StoredTokens | null> {
    const cookieHeader = request.headers.get("Cookie")
    const encrypted = await getAuthCookie().parse(cookieHeader)
    if (!encrypted) return null

    try {
        const json = await decrypt(encrypted, getSecret())
        return JSON.parse(json)
    } catch {
        return null // Decryption failed
    }
}

export async function serializeAuthCookie(
    tokens: StoredTokens,
): Promise<string> {
    const json = JSON.stringify(tokens)
    const encrypted = await encrypt(json, getSecret())
    return getAuthCookie().serialize(encrypted)
}

export async function clearAuthCookie(): Promise<string> {
    return getAuthCookie().serialize("", {maxAge: 0})
}
