import {
    DeviceCodeAuth,
    type DeviceCodeResult,
    type StoredTokens,
} from "@yotoplay/oauth-device-code-flow"
import {createYotoSdk, type YotoSdk} from "@yotoplay/yoto-sdk"
import {redirect} from "react-router"

import {
    clearAuthCookie,
    getTokensFromCookie,
    serializeAuthCookie,
} from "./auth-cookie.server"

// Auth0 configuration for Yoto
const AUTH_CONFIG = {
    domain: "login.yotoplay.com",
    clientId: "PhKouPhz6NPVaWLtyeiEwjfB7m8sVR77",
    audience: "https://api.yotoplay.com",
}

// Type for the env we need (subset of full Env)
type AuthEnv = {
    YOTO_AUTH_SECRET: string
}

// Lazy-initialized singletons
let _auth: DeviceCodeAuth | null = null
let _sdk: YotoSdk | null = null
let _sdkToken: string | null = null

const getAuth = (): DeviceCodeAuth => {
    if (!_auth) {
        _auth = new DeviceCodeAuth(AUTH_CONFIG)
    }
    return _auth
}

type TokenStatus =
    | {valid: true; expiresIn: string; expiresAt: number; setCookie?: string}
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

const getTimeUntilExpiry = (tokens: StoredTokens): number => {
    const now = Date.now()
    const expiresAtMs =
        tokens.expiresAt > 1e12 ? tokens.expiresAt : tokens.expiresAt * 1000
    return Math.floor((expiresAtMs - now) / 1000)
}

const isTokenExpired = (tokens: StoredTokens): boolean => {
    return getTimeUntilExpiry(tokens) <= 0
}

// Initiates device code flow - returns info for user to complete auth
const initiateLogin = async (): Promise<DeviceCodeResult> => {
    const auth = getAuth()
    return auth.initiate()
}

// Polls for token after user completes auth in browser
// Returns the Set-Cookie header value on success
const completeLogin = async (
    env: AuthEnv,
    deviceCode: string,
    interval: number,
    timeout: number = 300000, // 5 minutes default
): Promise<
    | {success: true; expiresIn: string; setCookie: string}
    | {success: false; error: string}
> => {
    const auth = getAuth()

    const result = await auth.pollForToken(deviceCode, interval, timeout)

    if (!result.success || !result.tokens) {
        return {success: false, error: result.error ?? "Authentication failed"}
    }

    const setCookie = await serializeAuthCookie(result.tokens, env)
    const timeRemaining = getTimeUntilExpiry(result.tokens)
    const expiresIn = formatTimeRemaining(timeRemaining)

    return {success: true, expiresIn, setCookie}
}

// Returns Set-Cookie header to clear auth
const logout = async (env: AuthEnv): Promise<string> => {
    return clearAuthCookie(env)
}

// Returns token status (requires request to read cookie)
const status = async (request: Request, env: AuthEnv): Promise<TokenStatus> => {
    const tokens = await getTokensFromCookie(request, env)

    if (!tokens) {
        return {valid: false, reason: "not_logged_in"}
    }

    if (isTokenExpired(tokens)) {
        // Try to refresh if we have a refresh token
        if (tokens.refreshToken) {
            const refreshResult = await tryRefreshToken(
                env,
                tokens.refreshToken,
            )
            if (refreshResult) {
                const timeRemaining = getTimeUntilExpiry(refreshResult.tokens)
                return {
                    valid: true,
                    expiresIn: formatTimeRemaining(timeRemaining),
                    expiresAt: refreshResult.tokens.expiresAt,
                    setCookie: refreshResult.setCookie,
                }
            }
        }
        return {valid: false, reason: "expired"}
    }

    const timeRemaining = getTimeUntilExpiry(tokens)
    return {
        valid: true,
        expiresIn: formatTimeRemaining(timeRemaining),
        expiresAt: tokens.expiresAt,
    }
}

// Attempts to refresh the token, returns new tokens and cookie or null
const tryRefreshToken = async (
    env: AuthEnv,
    refreshToken: string,
): Promise<{tokens: StoredTokens; setCookie: string} | null> => {
    const auth = getAuth()

    try {
        const result = await auth.refreshToken(refreshToken)
        if (result.success && result.tokens) {
            const setCookie = await serializeAuthCookie(result.tokens, env)
            return {tokens: result.tokens, setCookie}
        }
    } catch {
        // Refresh failed, token is invalid
    }

    return null
}

// Gets valid access token, refreshing if needed
// Returns token and optional setCookie if token was refreshed
const getToken = async (
    request: Request,
    env: AuthEnv,
): Promise<{token: string; setCookie?: string} | null> => {
    const tokens = await getTokensFromCookie(request, env)

    if (!tokens) {
        return null
    }

    // If token is expired or about to expire (within 5 minutes), try to refresh
    const timeRemaining = getTimeUntilExpiry(tokens)
    if (timeRemaining < 300 && tokens.refreshToken) {
        const refreshResult = await tryRefreshToken(env, tokens.refreshToken)
        if (refreshResult) {
            return {
                token: refreshResult.tokens.accessToken,
                setCookie: refreshResult.setCookie,
            }
        }
    }

    if (isTokenExpired(tokens)) {
        return null
    }

    return {token: tokens.accessToken}
}

// Gets valid token or throws (for use in API calls)
const requireAuthCore = async (
    request: Request,
    env: AuthEnv,
): Promise<{token: string; setCookie?: string}> => {
    const result = await getToken(request, env)

    if (!result) {
        const tokenStatus = await status(request, env)
        if (tokenStatus.valid === false && tokenStatus.reason === "expired") {
            throw new Error("Token expired. Please log in again.")
        }
        throw new Error("Not logged in. Please log in.")
    }

    return result
}

// Creates an authenticated Yoto SDK instance (singleton for cache reuse)
const getYotoSdk = (token: string): YotoSdk => {
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
const requireAuth = async (
    request: Request,
    env: AuthEnv,
): Promise<{
    valid: true
    expiresIn: string
    expiresAt: number
    setCookie?: string
}> => {
    const authStatus = await status(request, env)

    if (!authStatus.valid) {
        throw redirect("/login")
    }

    return authStatus
}

// Helper to get authenticated SDK, with redirect on failure
// Returns SDK and optional setCookie if token was refreshed
const getAuthenticatedSdk = async (
    request: Request,
    env: AuthEnv,
): Promise<{sdk: YotoSdk; setCookie?: string}> => {
    const {setCookie} = await requireAuth(request, env)
    const tokenResult = await getToken(request, env)

    if (!tokenResult) {
        throw redirect("/login")
    }

    const sdk = getYotoSdk(tokenResult.token)
    return {sdk, setCookie: setCookie ?? tokenResult.setCookie}
}

// Check if user is authenticated (without redirect)
const isAuthenticated = async (
    request: Request,
    env: AuthEnv,
): Promise<boolean> => {
    const authStatus = await status(request, env)
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
