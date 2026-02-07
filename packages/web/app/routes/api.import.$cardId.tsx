import {requireAuth} from "~/lib/auth.server"
import {performSyncToCard, type SyncProgress} from "~/lib/sync.server"

export async function loader({
    params,
    request,
}: {
    params: {cardId: string}
    request: Request
}) {
    await requireAuth()

    const url = new URL(request.url)
    const youtubeUrl = url.searchParams.get("url")
    const cardId = params.cardId

    if (!youtubeUrl) {
        return new Response("Missing url parameter", {status: 400})
    }

    const validatedUrl = youtubeUrl

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
                validatedUrl,
                cardId,
                async (progress: SyncProgress) => {
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
