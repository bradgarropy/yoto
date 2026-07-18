import {beforeEach, describe, expect, it, vi} from "vitest"

import type {ImportWorkflowParams} from "~/lib/import"
import {createMockEnv} from "~/tests/mocks"

const mockDestroySandbox = vi.fn()
const mockGetProgress = vi.fn()
const mockGetYotoSdk = vi.fn()
const mockImportVideo = vi.fn()
const mockInspectVideo = vi.fn()
const mockReadImportCredential = vi.fn()
const mockReportComplete = vi.fn()
const mockReportError = vi.fn()
const mockReportProgress = vi.fn()
const mockTranscodeAudio = vi.fn()
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
    importVideo: (...args: unknown[]) => mockImportVideo(...args),
    inspectVideo: (...args: unknown[]) => mockInspectVideo(...args),
    transcodeAudio: (...args: unknown[]) => mockTranscodeAudio(...args),
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
    splitByChapters: true,
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
const importedTracks = [
    {
        index: 0,
        track: inspectedTracks[0],
        audio: {alreadyTranscoded: false as const, sha256: "audio-sha"},
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

const createEvent = () =>
    ({payload: cardImport}) as Parameters<ImportWorkflow["run"]>[0]

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
        vi.spyOn(console, "info").mockImplementation(() => {})
        vi.spyOn(console, "warn").mockImplementation(() => {})

        mockDestroySandbox.mockResolvedValue(undefined)
        mockGetProgress.mockReturnValue({
            reportComplete: mockReportComplete,
            reportError: mockReportError,
            reportProgress: mockReportProgress,
        })
        mockGetYotoSdk.mockReturnValue({content: {}, media: {}})
        mockImportVideo.mockResolvedValue(importedTracks)
        mockInspectVideo.mockResolvedValue(inspectedTracks)
        mockReadImportCredential.mockResolvedValue("access-token")
        mockTranscodeAudio.mockResolvedValue(transcodedTracks)
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
            "import video",
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
            3,
            "transcode audio",
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
        expect(mockImportVideo).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Object),
            expect.objectContaining({id: cardImport.id}),
            inspectedTracks,
            expect.any(Function),
        )
        expect(mockTranscodeAudio).toHaveBeenCalledWith(
            expect.any(Object),
            cardImport.cardId,
            importedTracks,
            expect.any(Function),
        )
        expect(mockUpdateCard).toHaveBeenCalledWith(
            expect.any(Object),
            cardImport.cardId,
            transcodedTracks,
            expect.any(Function),
        )
        expect(mockReadImportCredential).toHaveBeenCalledTimes(3)
        expect(mockReportComplete).toHaveBeenCalledWith(importResult)
        expect(mockReportError).not.toHaveBeenCalled()
        expect(mockDestroySandbox).toHaveBeenCalledWith(
            expect.any(Object),
            `import-${cardImport.id}`,
        )
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

        expect(mockImportVideo).not.toHaveBeenCalled()
        expect(mockReportError).toHaveBeenCalledWith("Containers unavailable")
        expect(mockDestroySandbox).toHaveBeenCalledWith(
            expect.any(Object),
            `import-${cardImport.id}`,
        )
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
            "Failed to destroy import sandbox",
            expect.objectContaining({error: "Cleanup failed"}),
        )
    })
})
