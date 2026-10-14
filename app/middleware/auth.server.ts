import type {YotoSdk} from "@yotoplay/yoto-sdk"
import {createContext, type MiddlewareFunction} from "react-router"

import {getAuthenticatedSdk} from "~/lib/auth.server"
import {cloudflareContext} from "~/lib/cloudflare-context"

type AuthContext = {
    sdk: YotoSdk
    setCookie?: string
}

// Context to share authenticated SDK across loaders/actions
export const authContext = createContext<AuthContext>()

// Middleware that checks auth and provides SDK via context
export const authMiddleware: MiddlewareFunction<Response> = async (
    {request, context},
    next,
) => {
    // Get env from Cloudflare context
    const {env} = context.get(cloudflareContext)

    const {sdk, setCookie} = await getAuthenticatedSdk(request, env)
    context.set(authContext, {sdk, setCookie})

    const response = await next()

    if (setCookie) {
        response.headers.append("Set-Cookie", setCookie)
    }

    return response
}
