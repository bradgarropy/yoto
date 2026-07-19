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
import {EVENT, telemetry} from "./telemetry.server"

// Auth0 configuration for Yoto
const AUTH_CONFIG = {
    domain: "login.yotoplay.com",
    clientId: "PhKouPhz6NPVaWLtyeiEwjfB7m8sVR77",
    audience: "https://api.yotoplay.com",
}
const AUTH_SCOPE = "offline_access"

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

const isSecureRequest = (request: Request): boolean => {
    return new URL(request.url).protocol === "https:"
}

const getAuthFailureReason = (error?: string) => {
    switch (error) {
        case "access_denied":
            return "access_denied"
        case "expired_token":
            return "expired_token"
        case "Authentication timeout. Please try again.":
            return "timeout"
        default:
            return "provider_error"
    }
}

// Initiates device code flow - returns info for user to complete auth
const initiateLogin = async (): Promise<DeviceCodeResult> => {
    const startedAt = Date.now()
    const auth = getAuth()

    telemetry.info(EVENT.AUTH.LOGIN.STARTED)

    try {
        const result = await auth.initiate(AUTH_SCOPE)

        if (!result.success) {
            telemetry.error(EVENT.AUTH.LOGIN.FAILED, {
                stage: "initiate",
                reason: getAuthFailureReason(result.error),
                durationMs: Date.now() - startedAt,
            })
        }

        return result
    } catch (error) {
        telemetry.error(EVENT.AUTH.LOGIN.FAILED, {
            stage: "initiate",
            reason: "unexpected_error",
            errorName: error instanceof Error ? error.name : "UnknownError",
            durationMs: Date.now() - startedAt,
        })
        throw error
    }
}

// Polls for token after user completes auth in browser
// Returns the Set-Cookie header value on success
const completeLogin = async (
    request: Request,
    env: Env,
    deviceCode: string,
    interval: number,
    timeout: number = 300000, // 5 minutes default
): Promise<
    | {success: true; expiresIn: string; setCookie: string}
    | {success: false; error: string}
> => {
    const startedAt = Date.now()
    const auth = getAuth()

    try {
        const result = await auth.pollForToken(deviceCode, interval, timeout)

        if (!result.success || !result.tokens) {
            const error = result.error ?? "Authentication failed"
            const reason = getAuthFailureReason(error)
            const context = {
                stage: "complete",
                reason,
                durationMs: Date.now() - startedAt,
            }

            if (reason === "provider_error") {
                telemetry.error(EVENT.AUTH.LOGIN.FAILED, context)
            } else {
                telemetry.warn(EVENT.AUTH.LOGIN.FAILED, context)
            }

            return {success: false, error}
        }

        const setCookie = await serializeAuthCookie(
            result.tokens,
            env,
            isSecureRequest(request),
        )
        const timeRemaining = getTimeUntilExpiry(result.tokens)
        const expiresIn = formatTimeRemaining(timeRemaining)

        telemetry.info(EVENT.AUTH.LOGIN.COMPLETED, {
            durationMs: Date.now() - startedAt,
        })

        return {success: true, expiresIn, setCookie}
    } catch (error) {
        telemetry.error(EVENT.AUTH.LOGIN.FAILED, {
            stage: "complete",
            reason: "unexpected_error",
            errorName: error instanceof Error ? error.name : "UnknownError",
            durationMs: Date.now() - startedAt,
        })
        throw error
    }
}

// Returns Set-Cookie header to clear auth
const logout = async (request: Request, env: Env): Promise<string> => {
    const startedAt = Date.now()

    try {
        const setCookie = await clearAuthCookie(env, isSecureRequest(request))

        telemetry.info(EVENT.AUTH.LOGOUT.COMPLETED, {
            durationMs: Date.now() - startedAt,
        })

        return setCookie
    } catch (error) {
        telemetry.error(EVENT.AUTH.LOGOUT.FAILED, {
            reason: "unexpected_error",
            errorName: error instanceof Error ? error.name : "UnknownError",
            durationMs: Date.now() - startedAt,
        })
        throw error
    }
}

// Returns token status (requires request to read cookie)
const status = async (request: Request, env: Env): Promise<TokenStatus> => {
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
                isSecureRequest(request),
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
    env: Env,
    refreshToken: string,
    secure: boolean,
): Promise<{tokens: StoredTokens; setCookie: string} | null> => {
    const startedAt = Date.now()
    const auth = getAuth()

    try {
        const result = await auth.refreshToken(refreshToken)
        if (result.success && result.tokens) {
            const setCookie = await serializeAuthCookie(
                result.tokens,
                env,
                secure,
            )

            telemetry.info(EVENT.AUTH.REFRESH.COMPLETED, {
                durationMs: Date.now() - startedAt,
            })

            return {tokens: result.tokens, setCookie}
        }

        telemetry.warn(EVENT.AUTH.REFRESH.FAILED, {
            reason: "rejected",
            durationMs: Date.now() - startedAt,
        })
    } catch (error) {
        telemetry.error(EVENT.AUTH.REFRESH.FAILED, {
            reason: "unexpected_error",
            errorName: error instanceof Error ? error.name : "UnknownError",
            durationMs: Date.now() - startedAt,
        })
    }

    return null
}

// Gets valid access token, refreshing if needed
// Returns token and optional setCookie if token was refreshed
const getToken = async (
    request: Request,
    env: Env,
): Promise<{token: string; setCookie?: string} | null> => {
    const tokens = await getTokensFromCookie(request, env)

    if (!tokens) {
        return null
    }

    // If token is expired or about to expire (within 5 minutes), try to refresh
    const timeRemaining = getTimeUntilExpiry(tokens)
    if (timeRemaining < 300 && tokens.refreshToken) {
        const refreshResult = await tryRefreshToken(
            env,
            tokens.refreshToken,
            isSecureRequest(request),
        )
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
    env: Env,
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
    env: Env,
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
    env: Env,
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
    env: Env,
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
