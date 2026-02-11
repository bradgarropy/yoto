import {join} from "node:path"

import {
    DeviceCodeAuth,
    type DeviceCodeResult,
    type StoredTokens,
    TokenManager,
} from "@yotoplay/oauth-device-code-flow"
import {createYotoSdk, type YotoSdk} from "@yotoplay/yoto-sdk"
import {redirect} from "react-router"

import {CONFIG_PATH, ensureConfigDir} from "./paths.server"

// Auth0 configuration for Yoto
const AUTH_CONFIG = {
    domain: "login.yotoplay.com",
    clientId: "PhKouPhz6NPVaWLtyeiEwjfB7m8sVR77",
    audience: "https://api.yotoplay.com",
}

const TOKEN_PATH = join(CONFIG_PATH, "auth.json")

// Lazy-initialized singletons
let _auth: DeviceCodeAuth | null = null
let _tokenManager: TokenManager | null = null
let _sdk: YotoSdk | null = null
let _sdkToken: string | null = null

const getAuth = (): DeviceCodeAuth => {
    if (!_auth) {
        _auth = new DeviceCodeAuth(AUTH_CONFIG)
    }
    return _auth
}

const getTokenManager = (): TokenManager => {
    if (!_tokenManager) {
        ensureConfigDir()
        _tokenManager = new TokenManager(TOKEN_PATH)
    }
    return _tokenManager
}

type TokenStatus =
    | {valid: true; expiresIn: string; expiresAt: number}
    | {valid: false; reason: "not_logged_in" | "expired"}

const formatTimeRemaining = (seconds: number): string => {
    if (seconds < 60) {
        return `${seconds} seconds`
    }

    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) {
        return `${minutes} minute${minutes === 1 ? "" : "s"}`
    }

    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60

    if (remainingMinutes === 0) {
        return `${hours} hour${hours === 1 ? "" : "s"}`
    }

    return `${hours} hour${hours === 1 ? "" : "s"}, ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`
}

// Initiates device code flow - returns info for user to complete auth
const initiateLogin = async (): Promise<DeviceCodeResult> => {
    const auth = getAuth()
    return auth.initiate()
}

// Polls for token after user completes auth in browser
const completeLogin = async (
    deviceCode: string,
    interval: number,
    timeout: number = 300000, // 5 minutes default
): Promise<
    {success: true; expiresIn: string} | {success: false; error: string}
> => {
    const auth = getAuth()
    const tokenManager = getTokenManager()

    const result = await auth.pollForToken(deviceCode, interval, timeout)

    if (!result.success || !result.tokens) {
        return {success: false, error: result.error ?? "Authentication failed"}
    }

    await tokenManager.saveTokens(result.tokens)

    const timeRemaining = tokenManager.getTimeUntilExpiry(result.tokens)
    const expiresIn = formatTimeRemaining(timeRemaining)

    return {success: true, expiresIn}
}

// Clears stored tokens
const logout = async (): Promise<void> => {
    const tokenManager = getTokenManager()
    await tokenManager.clearTokens()
}

// Returns token status
const status = async (): Promise<TokenStatus> => {
    const tokenManager = getTokenManager()
    const tokens = await tokenManager.loadTokens()

    if (!tokens) {
        return {valid: false, reason: "not_logged_in"}
    }

    if (tokenManager.isTokenExpired(tokens)) {
        // Try to refresh if we have a refresh token
        if (tokens.refreshToken) {
            const refreshed = await tryRefreshToken(tokens.refreshToken)
            if (refreshed) {
                const timeRemaining = tokenManager.getTimeUntilExpiry(refreshed)
                return {
                    valid: true,
                    expiresIn: formatTimeRemaining(timeRemaining),
                    expiresAt: refreshed.expiresAt,
                }
            }
        }
        return {valid: false, reason: "expired"}
    }

    const timeRemaining = tokenManager.getTimeUntilExpiry(tokens)
    return {
        valid: true,
        expiresIn: formatTimeRemaining(timeRemaining),
        expiresAt: tokens.expiresAt,
    }
}

// Attempts to refresh the token, returns new tokens or null
const tryRefreshToken = async (
    refreshToken: string,
): Promise<StoredTokens | null> => {
    const auth = getAuth()
    const tokenManager = getTokenManager()

    try {
        const result = await auth.refreshToken(refreshToken)
        if (result.success && result.tokens) {
            await tokenManager.saveTokens(result.tokens)
            return result.tokens
        }
    } catch {
        // Refresh failed, token is invalid
    }

    return null
}

// Gets valid access token, refreshing if needed
const getToken = async (): Promise<string | null> => {
    const tokenManager = getTokenManager()
    const tokens = await tokenManager.loadTokens()

    if (!tokens) {
        return null
    }

    // If token is expired or about to expire (within 5 minutes), try to refresh
    const timeRemaining = tokenManager.getTimeUntilExpiry(tokens)
    if (timeRemaining < 300 && tokens.refreshToken) {
        const refreshed = await tryRefreshToken(tokens.refreshToken)
        if (refreshed) {
            return refreshed.accessToken
        }
    }

    if (tokenManager.isTokenExpired(tokens)) {
        return null
    }

    return tokens.accessToken
}

// Gets valid token or throws (for use in API calls)
const requireAuthCore = async (): Promise<string> => {
    const token = await getToken()

    if (!token) {
        const tokenStatus = await status()
        if (tokenStatus.valid === false && tokenStatus.reason === "expired") {
            throw new Error("Token expired. Please log in again.")
        }
        throw new Error("Not logged in. Please log in.")
    }

    return token
}

// Creates an authenticated Yoto SDK instance (singleton for cache reuse)
const getYotoSdk = async (): Promise<YotoSdk> => {
    const token = await requireAuthCore()

    // Reuse existing SDK if token unchanged (preserves media URL cache)
    if (_sdk && _sdkToken === token) {
        return _sdk
    }

    // Token changed or first call - create new SDK
    _sdkToken = token
    _sdk = createYotoSdk({jwt: token})
    return _sdk
}

// Helper to require authentication in loaders
// Redirects to /login if not authenticated
const requireAuth = async () => {
    const authStatus = await status()

    if (!authStatus.valid) {
        throw redirect("/login")
    }

    return authStatus
}

// Helper to get authenticated SDK, with redirect on failure
const getAuthenticatedSdk = async () => {
    await requireAuth()
    return getYotoSdk()
}

// Check if user is authenticated (without redirect)
const isAuthenticated = async () => {
    const authStatus = await status()
    return authStatus.valid
}

export {
    completeLogin,
    getAuthenticatedSdk,
    getToken,
    getYotoSdk,
    initiateLogin,
    isAuthenticated,
    logout,
    requireAuth,
    requireAuthCore,
    status,
}

export type {DeviceCodeResult, TokenStatus}
