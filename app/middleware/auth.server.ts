import type {YotoSdk} from "@yotoplay/yoto-sdk"
import {createContext, type MiddlewareFunction, redirect} from "react-router"

import {getAuthenticatedSdk, status} from "~/lib/auth.server"

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
    const authStatus = await status(request)

    if (!authStatus.valid) {
        throw redirect("/login")
    }

    const {sdk, setCookie} = await getAuthenticatedSdk(request)
    context.set(authContext, {sdk, setCookie})

    const response = await next()

    if (setCookie) {
        response.headers.append("Set-Cookie", setCookie)
    }

    return response
}
