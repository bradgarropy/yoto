import {Hono} from "hono"
import {createRequestHandler, RouterContextProvider} from "react-router"

import {cloudflareContext} from "../app/lib/cloudflare-context"

// Re-export Sandbox class (required by Cloudflare)
export {Sandbox} from "@cloudflare/sandbox"

const app = new Hono<{Bindings: Env}>()

// React Router request handler
const requestHandler = createRequestHandler(
    () => import("virtual:react-router/server-build"),
    import.meta.env.MODE,
)

app.all("*", async c => {
    const contextProvider = new RouterContextProvider()
    // @ts-expect-error - Hono's ExecutionContext is compatible with what we need
    contextProvider.set(cloudflareContext, {env: c.env, ctx: c.executionCtx})
    return requestHandler(c.req.raw, contextProvider)
})

export default app
