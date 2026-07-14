import {beforeEach, describe, expect, it, vi} from "vitest"

import {createMockEnv} from "~/tests/mocks"

const mockCreateWorkflow = vi.fn()
const mockDestroySandbox = vi.fn()
const mockGetAuthenticatedSdk = vi.fn()
const mockIsAuthenticated = vi.fn()
const mockPerformSyncToCard = vi.fn()

vi.mock("~/lib/auth.server", () => ({
    getAuthenticatedSdk: (...args: unknown[]) =>
        mockGetAuthenticatedSdk(...args),
    isAuthenticated: (...args: unknown[]) => mockIsAuthenticated(...args),
}))

vi.mock("~/lib/cloudflare-context", () => ({
    cloudflareContext: Symbol("cloudflareContext"),
}))

vi.mock("~/lib/sandbox.server", () => ({
    destroySandbox: (...args: unknown[]) => mockDestroySandbox(...args),
}))

vi.mock("~/lib/sync.server", () => ({
    performSyncToCard: (...args: unknown[]) => mockPerformSyncToCard(...args),
}))

import {loader} from "./api.import.$cardId"

const youtubeUrl = "https://www.youtube.com/watch?v=video-1"
const cardId = "card-1"
const sdk = {content: {}, media: {}}

const createLoaderArgs = () => {
    const env = createMockEnv({
        UPLOAD_WORKFLOW: {
            create: mockCreateWorkflow,
        } as unknown as Env["UPLOAD_WORKFLOW"],
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
    mockCreateWorkflow.mockResolvedValue({})
    mockDestroySandbox.mockResolvedValue(undefined)
    mockGetAuthenticatedSdk.mockResolvedValue({sdk})
    mockIsAuthenticated.mockResolvedValue(true)
    mockPerformSyncToCard.mockResolvedValue({
        success: true,
        message: "Added 1 track",
        added: 1,
        skipped: 0,
    })
})

describe("api/import/:cardId loader", () => {
    it("starts a workflow correlated with the upload", async () => {
        const {args} = createLoaderArgs()

        const response = await loader(args)
        await response.text()

        expect(mockCreateWorkflow).toHaveBeenCalledOnce()

        const options = mockCreateWorkflow.mock.calls[0][0]
        expect(options).toEqual({
            id: options.params.id,
            params: {
                id: options.params.id,
                cardId,
                youtubeUrl,
            },
        })
        expect(mockPerformSyncToCard).toHaveBeenCalledOnce()
    })

    it("continues the existing sync when workflow creation fails", async () => {
        mockCreateWorkflow.mockRejectedValue(new Error("Workflow unavailable"))
        const {args} = createLoaderArgs()

        const response = await loader(args)
        const body = await response.text()

        expect(mockPerformSyncToCard).toHaveBeenCalledOnce()
        expect(body).toContain('"type":"complete"')
    })
})
