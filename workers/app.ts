import {createRequestHandler, RouterContextProvider} from "react-router"

import {cloudflareContext} from "../app/lib/cloudflare-context"

// Re-export Sandbox class (required by Cloudflare)
export {ImportWorkflow} from "./import-workflow"
export {Sandbox} from "@cloudflare/sandbox"

const requestHandler = createRequestHandler(
    () => import("virtual:react-router/server-build"),
    import.meta.env.MODE,
)

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<Response> {
        const contextProvider = new RouterContextProvider()
        contextProvider.set(cloudflareContext, {env, ctx})
        return requestHandler(request, contextProvider)
    },
} satisfies ExportedHandler<Env>
