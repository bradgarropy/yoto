import {isAuthenticated} from "~/lib/auth.server"
import {cloudflareContext} from "~/lib/cloudflare-context"
import {logger} from "~/lib/logger.server"

import type {Route} from "./+types/api.imports.$importId"

export async function loader({params, request, context}: Route.LoaderArgs) {
    const {env} = context.get(cloudflareContext)

    const authenticated = await isAuthenticated(request, env)
    if (!authenticated) {
        return Response.json({error: "Unauthorized"}, {status: 401})
    }

    const {importId} = params

    try {
        const instance = await env.IMPORT_WORKFLOW.get(importId)
        const instanceStatus = await instance.status()

        return Response.json({
            importId,
            status: instanceStatus.status,
            error: instanceStatus.error ?? null,
            output: instanceStatus.output ?? null,
        })
    } catch (error) {
        logger.warn({
            message: "import.status.read_failed",
            importId,
            error: error instanceof Error ? error.message : String(error),
        })

        return Response.json(
            {error: "Unable to get import status"},
            {status: 500},
        )
    }
}
