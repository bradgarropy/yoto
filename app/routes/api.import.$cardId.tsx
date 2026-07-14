import {getAuthenticatedSdk, isAuthenticated} from "~/lib/auth.server"
import {cloudflareContext} from "~/lib/cloudflare-context"
import {destroySandbox} from "~/lib/sandbox.server"
import {performSyncToCard} from "~/lib/sync.server"
import type {ImportProgress} from "~/lib/sync-utils"
import {getUploadSandboxId, type Upload} from "~/lib/upload"

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

    const upload: Upload = {
        id: crypto.randomUUID(),
        cardId,
        youtubeUrl,
    }
    const sandboxId = getUploadSandboxId(upload)

    // Create a TransformStream to handle the SSE
    const {readable, writable} = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    const sendEvent = async (data: object) => {
        await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    }

    async function runSync() {
        try {
            const result = await performSyncToCard(
                sdk,
                env,
                upload,
                async (progress: ImportProgress) => {
                    await sendEvent({type: "progress", ...progress})
                },
            )

            if ("error" in result) {
                await sendEvent({type: "error", error: result.error})
            } else {
                await sendEvent({
                    type: "complete",
                    success: true,
                    message: result.message,
                    added: result.added,
                    skipped: result.skipped,
                })
            }
        } catch (error) {
            await sendEvent({
                type: "error",
                error:
                    error instanceof Error
                        ? error.message
                        : "Import failed unexpectedly",
            })
        } finally {
            try {
                await destroySandbox(env, sandboxId)
            } catch (error) {
                console.warn("Failed to destroy import sandbox", {
                    sandboxId,
                    error:
                        error instanceof Error ? error.message : String(error),
                })
            }
            await writer.close()
        }
    }

    runSync()

    return new Response(readable, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    })
}
