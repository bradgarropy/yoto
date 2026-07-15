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
    const ctx = {
        storage: {get, put},
    } as unknown as DurableObjectState
    const progress = new ImportProgress(ctx, createMockEnv())

    return {get, progress, put}
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

        expect(put).toHaveBeenCalledWith("progress", update)
    })

    it("returns the latest progress", async () => {
        const {get, progress} = createProgress()
        const update: ImportProgressState = {
            phase: "transcoding",
            current: 1,
            total: 1,
        }
        get.mockResolvedValue(update)

        await expect(progress.getProgress()).resolves.toEqual(update)
    })

    it("returns null before progress is reported", async () => {
        const {get, progress} = createProgress()
        get.mockResolvedValue(undefined)

        await expect(progress.getProgress()).resolves.toBeNull()
    })
})
