import {isAuthenticated, requireAuthCore} from "~/lib/auth.server"
import {cloudflareContext} from "~/lib/cloudflare-context"
import type {Import, ImportWorkflowResult} from "~/lib/import"
import {createImportCredential} from "~/lib/import-credential.server"

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

    const {token} = await requireAuthCore(request, env)

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
    const importLogContext = {
        importId: cardImport.id,
        cardId,
    }

    let workflowInstance: WorkflowInstance

    try {
        const credential = await createImportCredential(token, env)
        workflowInstance = await env.IMPORT_WORKFLOW.create({
            id: cardImport.id,
            params: {...cardImport, credential},
        })
        console.info("Import workflow created", importLogContext)
    } catch (error) {
        console.error("Failed to start import workflow", {
            ...importLogContext,
            error: error instanceof Error ? error.message : String(error),
        })
        return Response.json({error: "Unable to start import"}, {status: 500})
    }

    // Create a TransformStream to handle the SSE
    const {readable, writable} = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    const sendEvent = async (data: object) => {
        await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    }

    async function observeImport() {
        try {
            await sendEvent({type: "started", importId: cardImport.id})

            while (!request.signal.aborted) {
                const instanceStatus = await workflowInstance.status()

                if (instanceStatus.status === "complete") {
                    const result =
                        instanceStatus.output as ImportWorkflowResult | null

                    if (!result) {
                        throw new Error("Import completed without a result")
                    }

                    await sendEvent({
                        type: "complete",
                        success: true,
                        message: result.message,
                        added: result.added,
                        skipped: result.skipped,
                    })
                    break
                }

                if (
                    instanceStatus.status === "errored" ||
                    instanceStatus.status === "terminated"
                ) {
                    throw new Error(
                        instanceStatus.error?.message ?? "Import failed",
                    )
                }

                await new Promise(resolve => setTimeout(resolve, 5000))
            }
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Import failed unexpectedly"
            if (!request.signal.aborted) {
                await sendEvent({type: "error", error: message})
            }
        } finally {
            await writer.close()
        }
    }

    void observeImport()

    return new Response(readable, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    })
}
