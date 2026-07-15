import {beforeEach, describe, expect, it, vi} from "vitest"

import type {ImportWorkflowParams} from "~/lib/import"
import {createMockEnv} from "~/tests/mocks"

const mockDestroySandbox = vi.fn()
const mockGetYotoSdk = vi.fn()
const mockPerformImportToCard = vi.fn()
const mockReadImportCredential = vi.fn()

vi.mock("cloudflare:workers", () => ({
    WorkflowEntrypoint: class {},
}))

vi.mock("~/lib/auth.server", () => ({
    getYotoSdk: (...args: unknown[]) => mockGetYotoSdk(...args),
}))

vi.mock("~/lib/import-credential.server", () => ({
    readImportCredential: (...args: unknown[]) =>
        mockReadImportCredential(...args),
}))

vi.mock("~/lib/import.server", () => ({
    performImportToCard: (...args: unknown[]) =>
        mockPerformImportToCard(...args),
}))

vi.mock("~/lib/sandbox.server", () => ({
    destroySandbox: (...args: unknown[]) => mockDestroySandbox(...args),
}))

import {ImportWorkflow} from "./import-workflow"

const cardImport: ImportWorkflowParams = {
    id: "import-1",
    cardId: "card-1",
    youtubeUrl: "https://www.youtube.com/watch?v=video-1",
    credential: "encrypted-token",
}

const createEvent = () =>
    ({payload: cardImport}) as Parameters<ImportWorkflow["run"]>[0]

const createWorkflow = () =>
    ({env: createMockEnv()}) as unknown as ImportWorkflow

const createStep = () =>
    ({
        do: vi.fn((_name, _config, callback) => callback()),
    }) as unknown as Parameters<ImportWorkflow["run"]>[1]

describe("ImportWorkflow", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockReadImportCredential.mockResolvedValue("access-token")
        mockGetYotoSdk.mockReturnValue({content: {}, media: {}})
        mockPerformImportToCard.mockResolvedValue({
            success: true,
            message: "Added 1 track",
            added: 1,
            skipped: 0,
        })
        mockDestroySandbox.mockResolvedValue(undefined)
    })

    it("performs and returns a completed import", async () => {
        const step = createStep()

        const result = await ImportWorkflow.prototype.run.call(
            createWorkflow(),
            createEvent(),
            step,
        )

        expect(step.do).toHaveBeenCalledWith(
            "import tracks",
            {
                retries: {limit: 0, delay: 0},
                timeout: "30 minutes",
            },
            expect.any(Function),
        )
        expect(mockReadImportCredential).toHaveBeenCalledWith(
            cardImport.credential,
            expect.any(Object),
        )
        expect(mockGetYotoSdk).toHaveBeenCalledWith("access-token")
        expect(mockPerformImportToCard).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Object),
            {
                id: cardImport.id,
                cardId: cardImport.cardId,
                youtubeUrl: cardImport.youtubeUrl,
            },
        )
        expect(mockDestroySandbox).toHaveBeenCalledWith(
            expect.any(Object),
            `import-${cardImport.id}`,
        )
        expect(result).toEqual({
            importId: cardImport.id,
            status: "success",
            message: "Added 1 track",
            added: 1,
            skipped: 0,
        })
    })

    it("fails and destroys the sandbox when the import reports an error", async () => {
        mockPerformImportToCard.mockResolvedValue({error: "Card not found"})
        const step = createStep()

        await expect(
            ImportWorkflow.prototype.run.call(
                createWorkflow(),
                createEvent(),
                step,
            ),
        ).rejects.toThrow("Card not found")

        expect(mockDestroySandbox).toHaveBeenCalledWith(
            expect.any(Object),
            `import-${cardImport.id}`,
        )
    })
})
