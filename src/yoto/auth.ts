import {decodeJwt} from "jose"
import {deleteAuth, readAuth, writeAuth} from "~/yoto/config"

type TokenStatus =
    | {valid: true; expiresIn: string; expiresAt: number}
    | {valid: false; reason: "not_logged_in" | "expired"}

const parseToken = (
    token: string,
): {accessToken: string; expiresAt: number} => {
    // Remove "Bearer " prefix if present
    const accessToken = token.replace(/^Bearer\s+/i, "").trim()

    const payload = decodeJwt(accessToken)
    const expiresAt = payload.exp

    if (!expiresAt) {
        throw new Error("Token missing expiration")
    }

    return {accessToken, expiresAt}
}

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

const login = (token: string): {success: true; expiresIn: string} => {
    const {accessToken, expiresAt} = parseToken(token)

    const now = Math.floor(Date.now() / 1000)
    if (expiresAt <= now) {
        throw new Error("Token is already expired")
    }

    writeAuth({accessToken, expiresAt})

    const expiresIn = formatTimeRemaining(expiresAt - now)
    return {success: true, expiresIn}
}

const logout = (): void => {
    deleteAuth()
}

const status = (): TokenStatus => {
    const auth = readAuth()

    if (!auth) {
        return {valid: false, reason: "not_logged_in"}
    }

    const now = Math.floor(Date.now() / 1000)
    if (auth.expiresAt <= now) {
        return {valid: false, reason: "expired"}
    }

    const expiresIn = formatTimeRemaining(auth.expiresAt - now)
    return {valid: true, expiresIn, expiresAt: auth.expiresAt}
}

const getToken = (): string | null => {
    const auth = readAuth()

    if (!auth) {
        return null
    }

    const now = Math.floor(Date.now() / 1000)
    if (auth.expiresAt <= now) {
        return null
    }

    return auth.accessToken
}

const requireAuth = (): string => {
    const token = getToken()

    if (!token) {
        const authStatus = status()
        if (authStatus.valid === false && authStatus.reason === "expired") {
            throw new Error("Token expired. Please run: yoto login")
        }
        throw new Error("Not logged in. Please run: yoto login")
    }

    return token
}

export {getToken, login, logout, requireAuth, status}
export type {TokenStatus}
