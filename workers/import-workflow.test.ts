import {beforeEach, describe, expect, it, vi} from "vitest"

import type {ImportWorkflowParams} from "~/lib/import"
import {EVENT} from "~/lib/telemetry.server"
import {createMockEnv} from "~/tests/mocks"

const mockDestroySandbox = vi.fn()
const mockCheckCardCapacity = vi.fn()
const mockGetProgress = vi.fn()
const mockGetYotoSdk = vi.fn()
const mockInspectVideo = vi.fn()
const mockProcessAudio = vi.fn()
const mockReadImportCredential = vi.fn()
const mockReportComplete = vi.fn()
const mockReportError = vi.fn()
const mockReportProgress = vi.fn()
const mockUpdateCard = vi.fn()

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
    checkCardCapacity: (...args: unknown[]) => mockCheckCardCapacity(...args),
    inspectVideo: (...args: unknown[]) => mockInspectVideo(...args),
    processAudio: (...args: unknown[]) => mockProcessAudio(...args),
    updateCard: (...args: unknown[]) => mockUpdateCard(...args),
}))

vi.mock("~/lib/sandbox.server", () => ({
    destroySandbox: (...args: unknown[]) => mockDestroySandbox(...args),
}))

import {ImportWorkflow} from "./import-workflow"

const cardImport: ImportWorkflowParams = {
    id: "import-1",
    cardId: "card-1",
    youtubeUrl: "https://www.youtube.com/watch?v=video-1",
    splitByChapters: false,
    credential: "encrypted-token",
}
const inspectedTracks = [
    {
        id: "video-1",
        title: "Test Video",
        url: cardImport.youtubeUrl,
        duration: 180,
    },
]
const transcodedTracks = [
    {
        index: 0,
        track: inspectedTracks[0],
        audio: {key: "transcoded-sha", duration: 180, fileSize: 100000},
    },
]
const importResult = {
    status: "success" as const,
    message: "Added 1 track",
    added: 1,
    skipped: 0,
}

const createEvent = (overrides: Partial<ImportWorkflowParams> = {}) =>
    ({
        payload: {...cardImport, ...overrides},
        timestamp: new Date(),
    }) as Parameters<ImportWorkflow["run"]>[0]

const createWorkflow = () =>
    ({
        env: createMockEnv({
            IMPORT_PROGRESS: {
                getByName: mockGetProgress,
            } as unknown as Env["IMPORT_PROGRESS"],
        }),
    }) as unknown as ImportWorkflow

const createStep = () =>
    ({
        do: vi.fn((_name, _config, callback) => callback()),
    }) as unknown as Parameters<ImportWorkflow["run"]>[1]

describe("ImportWorkflow", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, "debug").mockImplementation(() => {})
        vi.spyOn(console, "info").mockImplementation(() => {})
        vi.spyOn(console, "warn").mockImplementation(() => {})
        vi.spyOn(console, "error").mockImplementation(() => {})

        mockDestroySandbox.mockResolvedValue(undefined)
        mockCheckCardCapacity.mockResolvedValue(undefined)
        mockGetProgress.mockReturnValue({
            reportComplete: mockReportComplete,
            reportError: mockReportError,
            reportProgress: mockReportProgress,
        })
        mockGetYotoSdk.mockReturnValue({content: {}, media: {}})
        mockInspectVideo.mockResolvedValue(inspectedTracks)
        mockProcessAudio.mockResolvedValue(transcodedTracks)
        mockReadImportCredential.mockResolvedValue("access-token")
        mockUpdateCard.mockResolvedValue(importResult)
    })

    it("runs and checkpoints each import phase", async () => {
        const step = createStep()

        const result = await ImportWorkflow.prototype.run.call(
            createWorkflow(),
            createEvent(),
            step,
        )

        expect(step.do).toHaveBeenNthCalledWith(
            1,
            "inspect video",
            {
                retries: {
                    limit: 3,
                    delay: "5 seconds",
                    backoff: "exponential",
                },
                timeout: "5 minutes",
            },
            expect.any(Function),
        )
        expect(step.do).toHaveBeenNthCalledWith(
            2,
            "check card capacity",
            {
                retries: {limit: 0, delay: 0},
                timeout: "1 minute",
            },
            expect.any(Function),
        )
        expect(step.do).toHaveBeenNthCalledWith(
            3,
            "process audio",
            {
                retries: {
                    limit: 3,
                    delay: "10 seconds",
                    backoff: "exponential",
                },
                timeout: "30 minutes",
            },
            expect.any(Function),
        )
        expect(step.do).toHaveBeenNthCalledWith(
            4,
            "update card",
            {
                retries: {limit: 0, delay: 0},
                timeout: "5 minutes",
            },
            expect.any(Function),
        )
        expect(step.do).toHaveBeenNthCalledWith(
            5,
            "cleanup sandbox",
            {
                retries: {
                    limit: 3,
                    delay: "5 seconds",
                    backoff: "exponential",
                },
                timeout: "5 minutes",
            },
            expect.any(Function),
        )
        expect(mockInspectVideo).toHaveBeenCalledWith(
            expect.any(Object),
            {
                id: cardImport.id,
                cardId: cardImport.cardId,
                youtubeUrl: cardImport.youtubeUrl,
                splitByChapters: cardImport.splitByChapters,
            },
            expect.any(Function),
        )
        expect(mockProcessAudio).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Object),
            expect.objectContaining({
                id: cardImport.id,
                cardId: cardImport.cardId,
            }),
            inspectedTracks,
            expect.any(Function),
        )
        expect(mockCheckCardCapacity).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                id: cardImport.id,
                cardId: cardImport.cardId,
            }),
            inspectedTracks,
        )
        expect(mockUpdateCard).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                id: cardImport.id,
                cardId: cardImport.cardId,
            }),
            transcodedTracks,
            expect.any(Function),
        )
        expect(mockReadImportCredential).toHaveBeenCalledTimes(3)
        expect(mockReportComplete).toHaveBeenCalledWith(importResult)
        expect(mockReportError).not.toHaveBeenCalled()
        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                importId: cardImport.id,
                cardId: cardImport.cardId,
                youtubeUrl: cardImport.youtubeUrl,
                sourceType: "video",
                splitByChapters: false,
                durationMs: expect.any(Number),
                sourceTrackCount: 1,
                sourceDurationSeconds: 180,
                added: 1,
                skipped: 0,
                chapterSplitUnavailable: false,
                event: EVENT.IMPORT.COMPLETED,
                level: "info",
            }),
        )
        expect(mockDestroySandbox).toHaveBeenCalledWith(
            expect.any(Object),
            `import-${cardImport.id}`,
        )
        expect(result).toEqual({importId: cardImport.id, ...importResult})
    })

    it("describes the fallback when chapter splitting is requested without chapter markers", async () => {
        const result = await ImportWorkflow.prototype.run.call(
            createWorkflow(),
            createEvent({splitByChapters: true}),
            createStep(),
        )
        const description =
            "No YouTube chapters were found, so the video was added as a single track."

        expect(mockReportComplete).toHaveBeenCalledWith({
            ...importResult,
            description,
        })
        expect(result).toEqual({
            importId: cardImport.id,
            ...importResult,
            description,
        })
    })

    it("does not describe a fallback when chapter markers are available", async () => {
        mockInspectVideo.mockResolvedValue([
            {
                ...inspectedTracks[0],
                chapters: [{title: "Chapter One", startTime: 0, endTime: 180}],
            },
        ])

        const result = await ImportWorkflow.prototype.run.call(
            createWorkflow(),
            createEvent({splitByChapters: true}),
            createStep(),
        )

        expect(mockReportComplete).toHaveBeenCalledWith(importResult)
        expect(result).toEqual({importId: cardImport.id, ...importResult})
    })

    it("reports a terminal error after a phase exhausts its retries", async () => {
        mockInspectVideo.mockRejectedValue(new Error("Containers unavailable"))
        const step = createStep()

        await expect(
            ImportWorkflow.prototype.run.call(
                createWorkflow(),
                createEvent(),
                step,
            ),
        ).rejects.toThrow("Containers unavailable")

        expect(mockProcessAudio).not.toHaveBeenCalled()
        expect(mockReportError).toHaveBeenCalledWith("Containers unavailable")
        expect(console.error).toHaveBeenCalledWith(
            expect.objectContaining({
                importId: cardImport.id,
                cardId: cardImport.cardId,
                youtubeUrl: cardImport.youtubeUrl,
                sourceType: "video",
                splitByChapters: false,
                stage: "inspect_video",
                reason: "workflow_step_failed",
                errorName: "Error",
                errorMessage: "Containers unavailable",
                durationMs: expect.any(Number),
                event: EVENT.IMPORT.FAILED,
                level: "error",
            }),
        )
        expect(mockDestroySandbox).toHaveBeenCalledWith(
            expect.any(Object),
            `import-${cardImport.id}`,
        )
    })

    it("stops before processing audio when the card is full", async () => {
        const capacityError = new Error(
            "This import would exceed Yoto's 100-track card limit. This card has 100 tracks and the import contains 1 track.",
        )
        capacityError.name = "CardCapacityError"
        mockCheckCardCapacity.mockRejectedValue(capacityError)

        await expect(
            ImportWorkflow.prototype.run.call(
                createWorkflow(),
                createEvent(),
                createStep(),
            ),
        ).rejects.toThrow("100-track card limit")

        expect(mockProcessAudio).not.toHaveBeenCalled()
        expect(mockUpdateCard).not.toHaveBeenCalled()
        expect(mockReportError).toHaveBeenCalledWith(
            "This import would exceed Yoto's 100-track card limit. This card has 100 tracks and the import contains 1 track.",
        )
        expect(mockDestroySandbox).toHaveBeenCalled()
    })

    it("does not turn successful imports into failures when cleanup fails", async () => {
        mockDestroySandbox.mockRejectedValue(new Error("Cleanup failed"))

        const result = await ImportWorkflow.prototype.run.call(
            createWorkflow(),
            createEvent(),
            createStep(),
        )

        expect(result).toEqual({importId: cardImport.id, ...importResult})
        expect(console.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                message: "import.sandbox.destroy_failed",
                error: "Cleanup failed",
                level: "warn",
            }),
        )
    })
})
