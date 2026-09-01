import {beforeEach, describe, expect, it, vi} from "vitest"

import {EVENT} from "~/lib/telemetry.server"
import {createMockEnv} from "~/tests/mocks"

const mockCreateWorkflow = vi.fn()
const mockCreateImportCredential = vi.fn()
const mockGetProgress = vi.fn()
const mockIsAuthenticated = vi.fn()
const mockProgressFetch = vi.fn()
const mockRequireAuthCore = vi.fn()

vi.mock("~/lib/auth.server", () => ({
    isAuthenticated: (...args: unknown[]) => mockIsAuthenticated(...args),
    requireAuthCore: (...args: unknown[]) => mockRequireAuthCore(...args),
}))

vi.mock("~/lib/cloudflare-context", () => ({
    cloudflareContext: Symbol("cloudflareContext"),
}))

vi.mock("~/lib/import-credential.server", () => ({
    createImportCredential: (...args: unknown[]) =>
        mockCreateImportCredential(...args),
}))

import {loader} from "./api.import.$cardId"

const youtubeUrl = "https://www.youtube.com/watch?v=video-1"
const cardId = "card-1"
const token = "access-token"

const parseEvents = (body: string) =>
    body
        .trim()
        .split("\n\n")
        .map(event => {
            const data = event
                .split("\n")
                .find(line => line.startsWith("data: "))
            return JSON.parse(data!.slice(6))
        })

const createLoaderArgs = ({
    headers,
    importUrl = youtubeUrl,
    splitByChapters = "false",
}: {
    headers?: HeadersInit
    importUrl?: string | null
    splitByChapters?: string | null
} = {}) => {
    const env = createMockEnv({
        IMPORT_PROGRESS: {
            getByName: mockGetProgress,
        } as unknown as Env["IMPORT_PROGRESS"],
        IMPORT_WORKFLOW: {
            create: mockCreateWorkflow,
        } as unknown as Env["IMPORT_WORKFLOW"],
    })

    const searchParams = new URLSearchParams()
    if (importUrl !== null) searchParams.set("url", importUrl)
    if (splitByChapters !== null) {
        searchParams.set("splitByChapters", splitByChapters)
    }

    return {
        env,
        args: {
            params: {cardId},
            request: new Request(
                `http://localhost/api/import/${cardId}?${searchParams}`,
                {headers},
            ),
            context: {
                get: vi.fn().mockReturnValue({env}),
            },
        } as unknown as Parameters<typeof loader>[0],
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockCreateWorkflow.mockResolvedValue({})
    mockCreateImportCredential.mockResolvedValue("encrypted-token")
    mockGetProgress.mockReturnValue({fetch: mockProgressFetch})
    mockIsAuthenticated.mockResolvedValue(true)
    mockRequireAuthCore.mockResolvedValue({token})
    mockProgressFetch.mockImplementation((request: Request) => {
        const importId = request.headers.get("X-Import-Id")
        return new Response(
            `id: ${importId}\ndata: ${JSON.stringify({type: "started", importId})}\n\n` +
                `id: ${importId}\ndata: ${JSON.stringify({type: "progress", phase: "importing", percent: 65, total: 1, prepared: 1, uploaded: 1, ready: 0})}\n\n` +
                `id: ${importId}\ndata: ${JSON.stringify({type: "complete", success: true, message: "Added 1 track", added: 1, skipped: 0})}\n\n`,
        )
    })
})

describe("api/import/:cardId loader", () => {
    it("starts a workflow correlated with the import", async () => {
        const {args} = createLoaderArgs()

        const response = await loader(args)
        const events = parseEvents(await response.text())

        expect(mockCreateWorkflow).toHaveBeenCalledOnce()

        const options = mockCreateWorkflow.mock.calls[0][0]
        expect(options).toEqual({
            id: options.params.id,
            params: {
                id: options.params.id,
                cardId,
                youtubeUrl,
                splitByChapters: false,
                credential: "encrypted-token",
            },
        })
        expect(mockCreateImportCredential).toHaveBeenCalledWith(
            token,
            expect.any(Object),
        )
        expect(console.info).toHaveBeenCalledWith({
            importId: options.params.id,
            cardId,
            youtubeUrl,
            sourceType: "video",
            splitByChapters: false,
            event: EVENT.IMPORT.STARTED,
            level: "info",
        })
        expect(mockGetProgress).toHaveBeenCalledWith(options.params.id)
        expect(events[0]).toEqual({
            type: "started",
            importId: options.params.id,
        })
        expect(events[1]).toEqual({
            type: "progress",
            phase: "importing",
            percent: 65,
            total: 1,
            prepared: 1,
            uploaded: 1,
            ready: 0,
        })
        expect(events.at(-1)).toEqual({
            type: "complete",
            success: true,
            message: "Added 1 track",
            added: 1,
            skipped: 0,
        })
    })

    it("passes the chapter preference to the workflow", async () => {
        const {args} = createLoaderArgs({splitByChapters: "true"})

        await loader(args)

        expect(mockCreateWorkflow).toHaveBeenCalledWith({
            id: expect.any(String),
            params: {
                id: expect.any(String),
                cardId,
                youtubeUrl,
                splitByChapters: true,
                credential: "encrypted-token",
            },
        })
    })

    it("defaults the chapter preference when it is omitted", async () => {
        const {args} = createLoaderArgs({splitByChapters: null})

        await loader(args)

        expect(mockCreateWorkflow).toHaveBeenCalledWith({
            id: expect.any(String),
            params: expect.objectContaining({splitByChapters: false}),
        })
    })

    it("rejects an invalid chapter preference", async () => {
        const {args} = createLoaderArgs({splitByChapters: "yes"})

        const response = await loader(args)

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({
            error: "Invalid splitByChapters parameter",
        })
        expect(mockCreateWorkflow).not.toHaveBeenCalled()
    })

    it("rejects an invalid URL", async () => {
        const {args} = createLoaderArgs({importUrl: "not-a-url"})

        const response = await loader(args)

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({
            error: "Invalid url parameter",
        })
        expect(mockCreateWorkflow).not.toHaveBeenCalled()
    })

    it("rejects YouTube Mixes", async () => {
        const {args} = createLoaderArgs({
            importUrl:
                "https://www.youtube.com/watch?v=video-1&list=RDvideo-1&start_radio=1",
        })

        const response = await loader(args)

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({
            error: "YouTube Mixes are not supported.",
        })
        expect(mockCreateWorkflow).not.toHaveBeenCalled()
    })

    it("forwards progress errors to the client", async () => {
        mockProgressFetch.mockImplementation((request: Request) => {
            const importId = request.headers.get("X-Import-Id")
            return new Response(
                `id: ${importId}\ndata: ${JSON.stringify({type: "started", importId})}\n\n` +
                    `id: ${importId}\ndata: ${JSON.stringify({type: "error", error: "Card not found"})}\n\n`,
            )
        })
        const {args} = createLoaderArgs()

        const response = await loader(args)
        const events = parseEvents(await response.text())

        expect(events.at(-1)).toEqual({
            type: "error",
            error: "Card not found",
        })
    })

    it("reconnects to an existing import without creating another workflow", async () => {
        const {args} = createLoaderArgs({
            headers: {"Last-Event-ID": "import-existing"},
        })

        const response = await loader(args)
        const events = parseEvents(await response.text())

        expect(mockCreateWorkflow).not.toHaveBeenCalled()
        expect(mockCreateImportCredential).not.toHaveBeenCalled()
        expect(mockRequireAuthCore).not.toHaveBeenCalled()
        expect(mockGetProgress).toHaveBeenCalledWith("import-existing")
        expect(events[0]).toEqual({
            type: "started",
            importId: "import-existing",
        })
    })

    it("returns an error when workflow creation fails", async () => {
        mockCreateWorkflow.mockRejectedValue(new Error("Workflow unavailable"))
        const {args} = createLoaderArgs()

        const response = await loader(args)

        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toEqual({
            error: "Unable to start import",
        })
        expect(console.error).toHaveBeenCalledWith(
            expect.objectContaining({
                cardId,
                youtubeUrl,
                sourceType: "video",
                splitByChapters: false,
                stage: "create_workflow",
                reason: "workflow_creation_failed",
                errorName: "Error",
                event: EVENT.IMPORT.FAILED,
                level: "error",
            }),
        )
    })
})
