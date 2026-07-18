import {describe, expect, it, vi} from "vitest"

import type {ImportProgress as ImportProgressState} from "~/lib/import-utils"
import {createMockEnv} from "~/tests/mocks"

vi.mock("cloudflare:workers", () => ({
    DurableObject: class {
        protected ctx: DurableObjectState

        constructor(ctx: DurableObjectState) {
            this.ctx = ctx
        }
    },
}))

import {ImportProgress} from "./import-progress"

const createProgress = () => {
    const get = vi.fn()
    const put = vi.fn()
    get.mockResolvedValue(undefined)
    const ctx = {
        storage: {get, put},
    } as unknown as DurableObjectState
    const progress = new ImportProgress(ctx, createMockEnv())

    return {get, progress, put}
}

const readEvent = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const {value, done} = await reader.read()
    if (done || !value) return null

    const data = new TextDecoder()
        .decode(value)
        .split("\n")
        .find(line => line.startsWith("data: "))

    return data ? JSON.parse(data.slice(6)) : null
}

describe("ImportProgress", () => {
    it("persists reported progress", async () => {
        const {progress, put} = createProgress()
        const update: ImportProgressState = {
            phase: "downloading",
            current: 2,
            total: 3,
        }

        await progress.reportProgress(update)

        expect(put).toHaveBeenCalledWith("event", {
            type: "progress",
            ...update,
        })
    })

    it("broadcasts progress and completion to an SSE subscriber", async () => {
        const {progress} = createProgress()
        const response = await progress.fetch(
            new Request("https://example.com/events", {
                headers: {"X-Import-Id": "import-1"},
            }),
        )
        const reader = response.body!.getReader()

        await expect(readEvent(reader)).resolves.toEqual({
            type: "started",
            importId: "import-1",
        })

        await progress.reportProgress({
            phase: "transcoding",
            current: 1,
            total: 1,
        })
        await expect(readEvent(reader)).resolves.toEqual({
            type: "progress",
            phase: "transcoding",
            current: 1,
            total: 1,
        })

        await progress.reportComplete({
            status: "success",
            message: "Added 1 track",
            added: 1,
            skipped: 0,
            description:
                "No YouTube chapters were found, so the video was added as a single track.",
        })
        await expect(readEvent(reader)).resolves.toEqual({
            type: "complete",
            success: true,
            message: "Added 1 track",
            added: 1,
            skipped: 0,
            description:
                "No YouTube chapters were found, so the video was added as a single track.",
        })
        await expect(reader.read()).resolves.toEqual({
            value: undefined,
            done: true,
        })
    })

    it("replays the latest event to a new subscriber", async () => {
        const {get, progress} = createProgress()
        get.mockResolvedValue({
            type: "progress",
            phase: "uploading",
            current: 2,
            total: 3,
        })

        const response = await progress.fetch(
            new Request("https://example.com/events", {
                headers: {"X-Import-Id": "import-1"},
            }),
        )
        const reader = response.body!.getReader()

        await readEvent(reader)
        await expect(readEvent(reader)).resolves.toEqual({
            type: "progress",
            phase: "uploading",
            current: 2,
            total: 3,
        })
        await reader.cancel()
    })

    it("requires an import ID for subscriptions", async () => {
        const {progress} = createProgress()

        const response = await progress.fetch(
            new Request("https://example.com/events"),
        )

        expect(response.status).toBe(400)
    })
})
