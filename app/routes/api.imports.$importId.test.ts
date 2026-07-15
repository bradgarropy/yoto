import {beforeEach, describe, expect, it, vi} from "vitest"

import {createMockEnv} from "~/tests/mocks"

const mockGetWorkflow = vi.fn()
const mockIsAuthenticated = vi.fn()
const mockStatus = vi.fn()

vi.mock("~/lib/auth.server", () => ({
    isAuthenticated: (...args: unknown[]) => mockIsAuthenticated(...args),
}))

vi.mock("~/lib/cloudflare-context", () => ({
    cloudflareContext: Symbol("cloudflareContext"),
}))

import {loader} from "./api.imports.$importId"

const importId = "2e4a3b9d-38af-4c55-924a-9d16cc556fb7"

const createLoaderArgs = () => {
    const env = createMockEnv({
        IMPORT_WORKFLOW: {
            get: mockGetWorkflow,
        } as unknown as Env["IMPORT_WORKFLOW"],
    })

    return {
        env,
        args: {
            params: {importId},
            request: new Request(`http://localhost/api/imports/${importId}`),
            context: {
                get: vi.fn().mockReturnValue({env}),
            },
        } as unknown as Parameters<typeof loader>[0],
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mockGetWorkflow.mockResolvedValue({status: mockStatus})
    mockIsAuthenticated.mockResolvedValue(true)
    mockStatus.mockResolvedValue({
        status: "running",
        error: undefined,
        output: undefined,
    })
})

describe("api/imports/:importId loader", () => {
    it("returns 401 when the user is not authenticated", async () => {
        mockIsAuthenticated.mockResolvedValue(false)
        const {args} = createLoaderArgs()

        const response = await loader(args)

        expect(response.status).toBe(401)
        expect(mockGetWorkflow).not.toHaveBeenCalled()
    })

    it("returns the workflow instance status", async () => {
        mockStatus.mockResolvedValue({
            status: "complete",
            output: {importId},
        })
        const {args} = createLoaderArgs()

        const response = await loader(args)

        expect(mockGetWorkflow).toHaveBeenCalledWith(importId)
        expect(mockStatus).toHaveBeenCalledOnce()
        await expect(response.json()).resolves.toEqual({
            importId,
            status: "complete",
            error: null,
            output: {importId},
        })
    })

    it("returns 500 when the workflow status cannot be read", async () => {
        mockStatus.mockRejectedValue(new Error("Workflow unavailable"))
        const {args} = createLoaderArgs()

        const response = await loader(args)

        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toEqual({
            error: "Unable to get import status",
        })
    })
})
