import {getYotoSdk, status} from "@yoto/core/auth"
import {redirect} from "react-router"

// Re-export for server-side use
export type {DeviceCodeResult, TokenStatus} from "@yoto/core/auth"
export {
    completeLogin,
    getToken,
    getYotoSdk,
    initiateLogin,
    logout,
    requireAuth as requireAuthCore,
    status,
} from "@yoto/core/auth"

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

export {getAuthenticatedSdk, isAuthenticated, requireAuth}
