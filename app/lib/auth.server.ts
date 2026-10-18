import {createYotoSdk, type YotoSdk} from "@yotoplay/yoto-sdk"
import {env} from "cloudflare:workers"
import pkceChallenge from "pkce-challenge"
import {redirect} from "react-router"

import {
    clearAuthCookie,
    getTokensFromCookie,
    serializeAuthCookie,
} from "./auth-cookie.server"
import type {StoredTokens} from "./auth-types"
import {
    clearOAuthStateCookie,
    getOAuthStateFromCookie,
    serializeOAuthStateCookie,
} from "./oauth-state-cookie.server"
import {EVENT, telemetry} from "./telemetry.server"

// Auth0 configuration for Yoto
const AUTH_CONFIG = {
    domain: "login.yotoplay.com",
    audience: "https://api.yotoplay.com",
}
const AUTH_SCOPE =
    "user:content:view user:content:manage user:icons:manage offline_access"

// Lazy-initialized SDK singleton
let _sdk: YotoSdk | null = null
let _sdkToken: string | null = null

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

// Starts the Authorization Code flow with PKCE and redirects to Yoto.
const initiateLogin = async (request: Request) => {
    const startedAt = Date.now()

    telemetry.info(EVENT.AUTH.LOGIN.STARTED)

    try {
        const {code_verifier, code_challenge, code_challenge_method} =
            await pkceChallenge()
        const state = crypto.randomUUID()
        const redirectUri = `${new URL(request.url).origin}/auth/callback`
        const authorizationUrl = new URL(
            `https://${AUTH_CONFIG.domain}/authorize`,
        )

        authorizationUrl.search = new URLSearchParams({
            audience: AUTH_CONFIG.audience,
            scope: AUTH_SCOPE,
            response_type: "code",
            client_id: env.YOTO_CLIENT_ID,
            redirect_uri: redirectUri,
            state,
            code_challenge,
            code_challenge_method,
        }).toString()

        const setCookie = await serializeOAuthStateCookie(
            {state, codeVerifier: code_verifier, redirectUri},
            isSecureRequest(request),
        )

        return redirect(authorizationUrl.toString(), {
            headers: {"Set-Cookie": setCookie},
        })
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

type OAuthTokenResponse = {
    access_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
}

type RefreshTrigger = "expired" | "near_expiry"

class InvalidTokenResponseError extends Error {
    constructor() {
        super("Invalid token response")
        this.name = "InvalidTokenResponseError"
    }
}

const getSafeOAuthError = (value: unknown): string | undefined => {
    return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value)
        ? value
        : undefined
}

const getOAuthError = async (
    response: Response,
): Promise<string | undefined> => {
    try {
        const body = (await response.json()) as {error?: unknown}
        return getSafeOAuthError(body.error)
    } catch {
        // Provider responses are not guaranteed to be JSON.
    }

    return undefined
}

const getTokenResponse = async (
    response: Response,
): Promise<OAuthTokenResponse> => {
    try {
        return (await response.json()) as OAuthTokenResponse
    } catch {
        throw new InvalidTokenResponseError()
    }
}

const toStoredTokens = (
    tokenResponse: OAuthTokenResponse,
    requireRefreshToken = false,
): StoredTokens => {
    if (
        !tokenResponse.access_token ||
        !tokenResponse.token_type ||
        !Number.isFinite(tokenResponse.expires_in) ||
        tokenResponse.expires_in <= 0 ||
        (requireRefreshToken && !tokenResponse.refresh_token)
    ) {
        throw new InvalidTokenResponseError()
    }

    return {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: Date.now() + tokenResponse.expires_in * 1000,
        tokenType: tokenResponse.token_type,
    }
}

const redirectToLoginError = async (
    request: Request,
    reason: string,
): Promise<Response> => {
    const headers = new Headers()
    headers.append(
        "Set-Cookie",
        await clearOAuthStateCookie(isSecureRequest(request)),
    )

    return redirect(`/login?error=${encodeURIComponent(reason)}`, {headers})
}

// Validates Yoto's callback and exchanges its one-time code for tokens.
const completeLogin = async (request: Request): Promise<Response> => {
    const startedAt = Date.now()
    const callbackUrl = new URL(request.url)
    const providerError = callbackUrl.searchParams.get("error")
    const code = callbackUrl.searchParams.get("code")
    const returnedState = callbackUrl.searchParams.get("state")
    const oauthState = await getOAuthStateFromCookie(request)

    if (!returnedState) {
        telemetry.warn(EVENT.AUTH.LOGIN.FAILED, {
            stage: "complete",
            reason: "invalid_callback",
            durationMs: Date.now() - startedAt,
        })
        return redirectToLoginError(request, "invalid_callback")
    }

    if (!oauthState) {
        telemetry.warn(EVENT.AUTH.LOGIN.FAILED, {
            stage: "complete",
            reason: "expired_state",
            durationMs: Date.now() - startedAt,
        })
        return redirectToLoginError(request, "expired_state")
    }

    if (returnedState !== oauthState.state) {
        telemetry.warn(EVENT.AUTH.LOGIN.FAILED, {
            stage: "complete",
            reason: "state_mismatch",
            durationMs: Date.now() - startedAt,
        })
        return redirectToLoginError(request, "state_mismatch")
    }

    if (providerError) {
        const reason =
            providerError === "access_denied"
                ? "access_denied"
                : "provider_error"
        telemetry.warn(EVENT.AUTH.LOGIN.FAILED, {
            stage: "complete",
            reason,
            ...(getSafeOAuthError(providerError)
                ? {oauthError: providerError}
                : {}),
            durationMs: Date.now() - startedAt,
        })
        return redirectToLoginError(request, reason)
    }

    if (!code) {
        telemetry.warn(EVENT.AUTH.LOGIN.FAILED, {
            stage: "complete",
            reason: "invalid_callback",
            durationMs: Date.now() - startedAt,
        })
        return redirectToLoginError(request, "invalid_callback")
    }

    try {
        const response = await fetch(
            `https://${AUTH_CONFIG.domain}/oauth/token`,
            {
                method: "POST",
                headers: {"Content-Type": "application/x-www-form-urlencoded"},
                body: new URLSearchParams({
                    grant_type: "authorization_code",
                    client_id: env.YOTO_CLIENT_ID,
                    code_verifier: oauthState.codeVerifier,
                    code,
                    redirect_uri: oauthState.redirectUri,
                }),
            },
        )

        if (!response.ok) {
            const oauthError = await getOAuthError(response)
            telemetry.error(EVENT.AUTH.LOGIN.FAILED, {
                stage: "complete",
                reason: "token_exchange_rejected",
                httpStatus: response.status,
                ...(oauthError ? {oauthError} : {}),
                durationMs: Date.now() - startedAt,
            })
            return redirectToLoginError(request, "token_exchange_failed")
        }

        const tokenResponse = await getTokenResponse(response)
        const tokens = toStoredTokens(tokenResponse)
        const headers = new Headers()
        headers.append(
            "Set-Cookie",
            await serializeAuthCookie(tokens, env, isSecureRequest(request)),
        )
        headers.append(
            "Set-Cookie",
            await clearOAuthStateCookie(isSecureRequest(request)),
        )

        telemetry.info(EVENT.AUTH.LOGIN.COMPLETED, {
            expiresInSeconds: tokenResponse.expires_in,
            refreshTokenIssued: Boolean(tokenResponse.refresh_token),
            durationMs: Date.now() - startedAt,
        })

        return redirect("/cards", {headers})
    } catch (error) {
        telemetry.error(EVENT.AUTH.LOGIN.FAILED, {
            stage: "complete",
            reason:
                error instanceof InvalidTokenResponseError
                    ? "invalid_response"
                    : "request_failed",
            errorName: error instanceof Error ? error.name : "UnknownError",
            durationMs: Date.now() - startedAt,
        })
        return redirectToLoginError(request, "token_exchange_failed")
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
                "expired",
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
    workerEnv: Env,
    refreshToken: string,
    secure: boolean,
    trigger: RefreshTrigger,
): Promise<{tokens: StoredTokens; setCookie: string} | null> => {
    const startedAt = Date.now()

    telemetry.info(EVENT.AUTH.REFRESH.STARTED, {trigger})

    try {
        const response = await fetch(
            `https://${AUTH_CONFIG.domain}/oauth/token`,
            {
                method: "POST",
                headers: {"Content-Type": "application/x-www-form-urlencoded"},
                body: new URLSearchParams({
                    grant_type: "refresh_token",
                    client_id: env.YOTO_CLIENT_ID,
                    refresh_token: refreshToken,
                }),
            },
        )

        if (!response.ok) {
            const oauthError = await getOAuthError(response)
            telemetry.warn(EVENT.AUTH.REFRESH.FAILED, {
                reason: "rejected",
                trigger,
                httpStatus: response.status,
                ...(oauthError ? {oauthError} : {}),
                durationMs: Date.now() - startedAt,
            })
            return null
        }

        // Yoto refresh tokens are single-use, so require and store the rotated token.
        const tokenResponse = await getTokenResponse(response)
        const tokens = toStoredTokens(tokenResponse, true)
        const setCookie = await serializeAuthCookie(tokens, workerEnv, secure)

        telemetry.info(EVENT.AUTH.REFRESH.COMPLETED, {
            trigger,
            expiresInSeconds: tokenResponse.expires_in,
            refreshTokenRotated: true,
            durationMs: Date.now() - startedAt,
        })

        return {tokens, setCookie}
    } catch (error) {
        telemetry.error(EVENT.AUTH.REFRESH.FAILED, {
            reason:
                error instanceof InvalidTokenResponseError
                    ? "invalid_response"
                    : "request_failed",
            trigger,
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
        const trigger = timeRemaining <= 0 ? "expired" : "near_expiry"
        const refreshResult = await tryRefreshToken(
            env,
            tokens.refreshToken,
            isSecureRequest(request),
            trigger,
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
        const tokens = await getTokensFromCookie(request, env)
        if (tokens && isTokenExpired(tokens)) {
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

// Helper to get authenticated SDK, with redirect on failure
// Returns SDK and optional setCookie if token was refreshed
const getAuthenticatedSdk = async (
    request: Request,
    env: Env,
): Promise<{sdk: YotoSdk; setCookie?: string}> => {
    const tokenResult = await getToken(request, env)

    if (!tokenResult) {
        throw redirect("/login")
    }

    const sdk = getYotoSdk(tokenResult.token)
    return {sdk, setCookie: tokenResult.setCookie}
}

// Check if user is authenticated (without redirect)
const isAuthenticated = async (
    request: Request,
    env: Env,
): Promise<boolean> => {
    const tokens = await getTokensFromCookie(request, env)
    return Boolean(tokens && !isTokenExpired(tokens))
}

export {
    completeLogin,
    getAuthenticatedSdk,
    getToken,
    getYotoSdk,
    initiateLogin,
    isAuthenticated,
    logout,
    requireAuthCore,
    status,
}

export type {TokenStatus}
