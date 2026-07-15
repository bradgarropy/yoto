import {describe, expect, it, vi} from "vitest"

import type {ImportResult, ImportWorkflowParams} from "~/lib/import"
import {createMockEnv} from "~/tests/mocks"

const mockGetYotoSdk = vi.fn()
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

const createStep = (result: ImportResult) =>
    ({
        do: vi.fn((_name, callback) => callback()),
        waitForEvent: vi.fn().mockResolvedValue({
            type: "complete",
            payload: result,
        }),
    }) as unknown as Parameters<ImportWorkflow["run"]>[1]

describe("ImportWorkflow", () => {
    it("waits for and returns a completed import", async () => {
        mockReadImportCredential.mockResolvedValue("access-token")
        const step = createStep({
            status: "success",
            message: "Added 1 track",
            added: 1,
            skipped: 0,
        })

        const result = await ImportWorkflow.prototype.run.call(
            createWorkflow(),
            createEvent(),
            step,
        )

        expect(mockReadImportCredential).toHaveBeenCalledWith(
            cardImport.credential,
            expect.any(Object),
        )
        expect(mockGetYotoSdk).toHaveBeenCalledWith("access-token")
        expect(step.waitForEvent).toHaveBeenCalledWith(
            "wait for import result",
            {type: "complete", timeout: "1 hour"},
        )
        expect(result).toEqual({
            importId: cardImport.id,
            status: "success",
            message: "Added 1 track",
            added: 1,
            skipped: 0,
        })
    })

    it("fails when the import reports an error", async () => {
        mockReadImportCredential.mockResolvedValue("access-token")
        const step = createStep({status: "error", error: "Card not found"})

        await expect(
            ImportWorkflow.prototype.run.call(
                createWorkflow(),
                createEvent(),
                step,
            ),
        ).rejects.toThrow("Card not found")
    })
})
