import {beforeEach, describe, expect, it, vi} from "vitest"

import {createMockEnv} from "~/tests/mocks"

const mockCreateWorkflow = vi.fn()
const mockCreateImportCredential = vi.fn()
const mockIsAuthenticated = vi.fn()
const mockRequireAuthCore = vi.fn()
const mockWorkflowStatus = vi.fn()

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
        .map(event => JSON.parse(event.replace(/^data: /, "")))

const createLoaderArgs = () => {
    const env = createMockEnv({
        IMPORT_WORKFLOW: {
            create: mockCreateWorkflow,
        } as unknown as Env["IMPORT_WORKFLOW"],
    })

    return {
        env,
        args: {
            params: {cardId},
            request: new Request(
                `http://localhost/api/import/${cardId}?url=${encodeURIComponent(youtubeUrl)}`,
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
    mockCreateWorkflow.mockResolvedValue({status: mockWorkflowStatus})
    mockCreateImportCredential.mockResolvedValue("encrypted-token")
    mockIsAuthenticated.mockResolvedValue(true)
    mockRequireAuthCore.mockResolvedValue({token})
    mockWorkflowStatus.mockResolvedValue({
        status: "complete",
        output: {
            importId: "import-1",
            status: "success",
            message: "Added 1 track",
            added: 1,
            skipped: 0,
        },
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
                credential: "encrypted-token",
            },
        })
        expect(mockCreateImportCredential).toHaveBeenCalledWith(
            token,
            expect.any(Object),
        )
        expect(events[0]).toEqual({
            type: "started",
            importId: options.params.id,
        })
        expect(mockWorkflowStatus).toHaveBeenCalledOnce()
        expect(events.at(-1)).toEqual({
            type: "complete",
            success: true,
            message: "Added 1 track",
            added: 1,
            skipped: 0,
        })
    })

    it("reports workflow failures to the client", async () => {
        mockWorkflowStatus.mockResolvedValue({
            status: "errored",
            error: {message: "Card not found"},
        })
        const {args} = createLoaderArgs()

        const response = await loader(args)
        const events = parseEvents(await response.text())

        expect(events.at(-1)).toEqual({
            type: "error",
            error: "Card not found",
        })
    })

    it("reports missing workflow output to the client", async () => {
        mockWorkflowStatus.mockResolvedValue({
            status: "complete",
            output: null,
        })
        const {args} = createLoaderArgs()

        const response = await loader(args)
        const events = parseEvents(await response.text())

        expect(events.at(-1)).toEqual({
            type: "error",
            error: "Import completed without a result",
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
    })
})
