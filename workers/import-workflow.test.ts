import {describe, expect, it, vi} from "vitest"

import type {Import, ImportResult} from "~/lib/import"

vi.mock("cloudflare:workers", () => ({
    WorkflowEntrypoint: class {},
}))

import {ImportWorkflow} from "./import-workflow"

const cardImport: Import = {
    id: "import-1",
    cardId: "card-1",
    youtubeUrl: "https://www.youtube.com/watch?v=video-1",
}

const createEvent = () =>
    ({payload: cardImport}) as Parameters<ImportWorkflow["run"]>[0]

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
        const step = createStep({
            status: "success",
            message: "Added 1 track",
            added: 1,
            skipped: 0,
        })

        const result = await ImportWorkflow.prototype.run.call(
            {} as ImportWorkflow,
            createEvent(),
            step,
        )

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
        const step = createStep({status: "error", error: "Card not found"})

        await expect(
            ImportWorkflow.prototype.run.call(
                {} as ImportWorkflow,
                createEvent(),
                step,
            ),
        ).rejects.toThrow("Card not found")
    })
})
