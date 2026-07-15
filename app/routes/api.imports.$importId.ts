import {isAuthenticated} from "~/lib/auth.server"
import {cloudflareContext} from "~/lib/cloudflare-context"
import type {ImportStatusResponse} from "~/lib/import"

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

        const response: ImportStatusResponse = {
            importId,
            status: instanceStatus.status,
            error: instanceStatus.error ?? null,
            output:
                (instanceStatus.output as ImportStatusResponse["output"]) ??
                null,
        }

        return Response.json(response)
    } catch (error) {
        console.warn("Failed to get import workflow status", {
            importId,
            error: error instanceof Error ? error.message : String(error),
        })

        return Response.json(
            {error: "Unable to get import status"},
            {status: 500},
        )
    }
}
