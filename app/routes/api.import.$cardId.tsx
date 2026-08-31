import {isAuthenticated, requireAuthCore} from "~/lib/auth.server"
import {cloudflareContext} from "~/lib/cloudflare-context"
import type {Import} from "~/lib/import"
import {createImportCredential} from "~/lib/import-credential.server"
import {EVENT, telemetry} from "~/lib/telemetry.server"
import {
    getCanonicalYouTubeUrl,
    getYouTubeUrlType,
    isYouTubeMix,
} from "~/lib/youtube"
import {importSearchParamsSchema} from "~/schemas/import"

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

    const url = new URL(request.url)
    const searchParams = importSearchParamsSchema.safeParse(
        Object.fromEntries(url.searchParams),
    )
    const cardId = params.cardId

    if (!searchParams.success) {
        return Response.json(
            {
                error:
                    searchParams.error.issues[0]?.message ??
                    "Invalid import parameters",
            },
            {status: 400},
        )
    }

    const {url: youtubeUrl, splitByChapters} = searchParams.data

    if (isYouTubeMix(youtubeUrl)) {
        return Response.json(
            {error: "YouTube Mixes are not supported."},
            {status: 400},
        )
    }

    const existingImportId = request.headers.get("Last-Event-ID")
    if (existingImportId) {
        const progressInstance = env.IMPORT_PROGRESS.getByName(existingImportId)
        return progressInstance.fetch(
            createProgressRequest(request, existingImportId),
        )
    }

    const {token} = await requireAuthCore(request, env)
    const cardImport: Import = {
        id: crypto.randomUUID(),
        cardId,
        youtubeUrl,
        splitByChapters,
    }
    const importLogContext = {
        importId: cardImport.id,
        cardId,
        youtubeUrl: getCanonicalYouTubeUrl(youtubeUrl),
        sourceType: getYouTubeUrlType(youtubeUrl),
        splitByChapters,
    }
    const progressInstance = env.IMPORT_PROGRESS.getByName(cardImport.id)

    try {
        const credential = await createImportCredential(token, env)
        await env.IMPORT_WORKFLOW.create({
            id: cardImport.id,
            params: {...cardImport, credential},
        })
        telemetry.info(EVENT.IMPORT.STARTED, importLogContext)
    } catch (error) {
        telemetry.error(EVENT.IMPORT.FAILED, {
            ...importLogContext,
            stage: "create_workflow",
            reason: "workflow_creation_failed",
            errorName: error instanceof Error ? error.name : "UnknownError",
        })
        return Response.json({error: "Unable to start import"}, {status: 500})
    }

    return progressInstance.fetch(createProgressRequest(request, cardImport.id))
}

function createProgressRequest(request: Request, importId: string): Request {
    const headers = new Headers(request.headers)
    headers.set("X-Import-Id", importId)
    return new Request(request, {headers})
}
