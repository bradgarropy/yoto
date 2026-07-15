import {getAuthenticatedSdk, isAuthenticated} from "~/lib/auth.server"
import {cloudflareContext} from "~/lib/cloudflare-context"
import {
    getImportSandboxId,
    type Import,
    IMPORT_EVENT,
    type ImportResult,
} from "~/lib/import"
import {performImportToCard} from "~/lib/import.server"
import type {ImportProgress} from "~/lib/import-utils"
import {destroySandbox} from "~/lib/sandbox.server"

import type {Route} from "./+types/api.import.$cardId"

export async function loader({params, request, context}: Route.LoaderArgs) {
    // Get env from Cloudflare context
    const {env} = context.get(cloudflareContext)

    // Use isAuthenticated instead of requireAuth to avoid redirects
    // SSE endpoints should return 401, not redirect (which causes EventSource to hang)
    const authenticated = await isAuthenticated(request, env)
    if (!authenticated) {
        return Response.json({error: "Unauthorized"}, {status: 401})
    }

    const {sdk} = await getAuthenticatedSdk(request, env)

    const url = new URL(request.url)
    const youtubeUrl = url.searchParams.get("url")
    const cardId = params.cardId

    if (!youtubeUrl) {
        return Response.json({error: "Missing url parameter"}, {status: 400})
    }

    const cardImport: Import = {
        id: crypto.randomUUID(),
        cardId,
        youtubeUrl,
    }
    const sandboxId = getImportSandboxId(cardImport)
    const importLogContext = {
        importId: cardImport.id,
        sandboxId,
        cardId,
    }

    let workflowInstance: WorkflowInstance | null = null

    try {
        workflowInstance = await env.IMPORT_WORKFLOW.create({
            id: cardImport.id,
            params: cardImport,
        })
        console.info("Import workflow started", importLogContext)
    } catch (error) {
        console.warn("Failed to start import workflow", {
            ...importLogContext,
            error: error instanceof Error ? error.message : String(error),
        })
    }

    console.info("Import sandbox starting", importLogContext)

    // Create a TransformStream to handle the SSE
    const {readable, writable} = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    const sendEvent = async (data: object) => {
        await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    }

    const finishWorkflow = async (result: ImportResult) => {
        if (!workflowInstance) return

        try {
            await workflowInstance.sendEvent({
                type: IMPORT_EVENT.COMPLETE,
                payload: result,
            })
        } catch (error) {
            console.warn("Failed to finish import workflow", {
                ...importLogContext,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }

    async function runImport() {
        try {
            await sendEvent({type: "started", importId: cardImport.id})

            const result = await performImportToCard(
                sdk,
                env,
                cardImport,
                async (progress: ImportProgress) => {
                    await sendEvent({type: "progress", ...progress})
                },
            )

            if ("error" in result) {
                await finishWorkflow({status: "error", error: result.error})
                await sendEvent({type: "error", error: result.error})
            } else {
                await finishWorkflow({
                    status: "success",
                    message: result.message,
                    added: result.added,
                    skipped: result.skipped,
                })
                await sendEvent({
                    type: "complete",
                    success: true,
                    message: result.message,
                    added: result.added,
                    skipped: result.skipped,
                })
            }
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Import failed unexpectedly"

            await finishWorkflow({status: "error", error: message})
            await sendEvent({
                type: "error",
                error: message,
            })
        } finally {
            try {
                await destroySandbox(env, sandboxId)
                console.info("Import sandbox destroyed", importLogContext)
            } catch (error) {
                console.warn("Failed to destroy import sandbox", {
                    ...importLogContext,
                    error:
                        error instanceof Error ? error.message : String(error),
                })
            }
            await writer.close()
        }
    }

    runImport()

    return new Response(readable, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    })
}
