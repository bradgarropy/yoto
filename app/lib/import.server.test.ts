import type {YotoSdk} from "@yotoplay/yoto-sdk"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {createMockEnv} from "~/tests/mocks"

const mockGetPlaylistInfo = vi.fn()
const mockPrepareTrack = vi.fn()
const mockRemoveTrack = vi.fn()
const mockUploadTrack = vi.fn()

vi.mock("./sandbox.server", () => ({
    getPlaylistInfo: (...args: unknown[]) => mockGetPlaylistInfo(...args),
    prepareTrack: (...args: unknown[]) => mockPrepareTrack(...args),
    removeTrack: (...args: unknown[]) => mockRemoveTrack(...args),
    uploadTrack: (...args: unknown[]) => mockUploadTrack(...args),
}))

import {
    createAudioTracks,
    type ImportedTrack,
    importVideo,
    inspectVideo,
    transcodeAudio,
    updateCard,
} from "./import.server"

const mockEnv = createMockEnv()
const sandboxId = "import-test-job"
const sourceTrack = {
    id: "video-1",
    title: "Test Track",
    url: "https://www.youtube.com/watch?v=video-1",
    duration: 180,
}
const video = {
    id: "video-1",
    title: "Test Track",
    videos: [sourceTrack],
}
const cardImport = {
    id: "test-job",
    cardId: "card-1",
    youtubeUrl: sourceTrack.url,
    splitByChapters: false,
}
const preparedTrack = {
    path: "/tmp/video-1.mp3",
    filename: "video-1.mp3",
    sha256: "a".repeat(64),
    byteLength: 123456,
}

const mockGetCard = vi.fn()
const mockGetTranscodedUpload = vi.fn()
const mockGetUploadUrlForTranscode = vi.fn()
const mockUpdateCard = vi.fn()
const sdk = {
    content: {
        getCard: mockGetCard,
        updateCard: mockUpdateCard,
    },
    media: {
        getTranscodedUpload: mockGetTranscodedUpload,
        getUploadUrlForTranscode: mockGetUploadUrlForTranscode,
    },
} as unknown as YotoSdk

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})

    mockGetPlaylistInfo.mockResolvedValue(video)
    mockGetCard.mockResolvedValue({
        cardId: "card-1",
        title: "Test Card",
        content: {
            activity: "http://yoto.io/activities/playAudio",
            chapters: [],
            restricted: false,
            config: {onlineOnly: false},
            version: "1",
        },
        metadata: {},
    })
    mockPrepareTrack.mockResolvedValue(preparedTrack)
    mockRemoveTrack.mockResolvedValue(undefined)
    mockUpdateCard.mockResolvedValue(undefined)
    mockUploadTrack.mockResolvedValue(undefined)
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("createAudioTracks", () => {
    const videoWithChapters = {
        ...sourceTrack,
        chapters: [
            {title: "Chapter One", startTime: 0, endTime: 60},
            {title: "Chapter Two", startTime: 60, endTime: 180},
        ],
    }

    it("creates one track for each video when splitting is disabled", () => {
        expect(createAudioTracks([videoWithChapters], false)).toEqual([
            {
                id: sourceTrack.id,
                sourceId: sourceTrack.id,
                title: sourceTrack.title,
                url: sourceTrack.url,
                duration: sourceTrack.duration,
            },
        ])
    })

    it("creates one track for each chapter when splitting is enabled", () => {
        expect(createAudioTracks([videoWithChapters], true)).toEqual([
            {
                id: "video-1-01",
                sourceId: sourceTrack.id,
                title: "Chapter One",
                url: sourceTrack.url,
                duration: 60,
                startTime: 0,
                endTime: 60,
            },
            {
                id: "video-1-02",
                sourceId: sourceTrack.id,
                title: "Chapter Two",
                url: sourceTrack.url,
                duration: 120,
                startTime: 60,
                endTime: 180,
            },
        ])
    })

    it("creates one track when splitting is enabled without chapters", () => {
        expect(createAudioTracks([sourceTrack], true)).toEqual([
            {
                id: sourceTrack.id,
                sourceId: sourceTrack.id,
                title: sourceTrack.title,
                url: sourceTrack.url,
                duration: sourceTrack.duration,
            },
        ])
    })
})

describe("inspectVideo", () => {
    it("inspects the source without downloading audio", async () => {
        const onProgress = vi.fn()

        const result = await inspectVideo(mockEnv, cardImport, onProgress)

        expect(onProgress).toHaveBeenCalledWith({phase: "preparing"})
        expect(mockGetPlaylistInfo).toHaveBeenCalledWith(
            mockEnv,
            sandboxId,
            cardImport.youtubeUrl,
        )
        expect(mockPrepareTrack).not.toHaveBeenCalled()
        expect(result).toEqual(video.videos)
    })
})

describe("importVideo", () => {
    it("downloads, uploads, and removes prepared audio", async () => {
        mockGetTranscodedUpload.mockRejectedValueOnce(new Error("Not found"))
        mockGetUploadUrlForTranscode.mockResolvedValue({
            uploadId: preparedTrack.sha256,
            uploadUrl: "https://uploads.example.com/audio",
        })

        const result = await importVideo(sdk, mockEnv, cardImport, video.videos)

        expect(mockUploadTrack).toHaveBeenCalledWith(
            mockEnv,
            sandboxId,
            preparedTrack,
            "https://uploads.example.com/audio",
        )
        expect(mockRemoveTrack).toHaveBeenCalledWith(
            mockEnv,
            sandboxId,
            preparedTrack,
        )
        expect(result).toEqual([
            {
                index: 0,
                track: sourceTrack,
                audio: {
                    alreadyTranscoded: false,
                    sha256: preparedTrack.sha256,
                },
            },
        ])
    })

    it("uses cached Yoto audio without uploading it again", async () => {
        mockGetTranscodedUpload.mockResolvedValue({
            progress: {phase: "complete"},
            transcodedSha256: "transcoded-sha",
            transcodedInfo: {duration: 180, fileSize: 100000},
        })

        const result = await importVideo(sdk, mockEnv, cardImport, video.videos)

        expect(mockGetUploadUrlForTranscode).not.toHaveBeenCalled()
        expect(mockUploadTrack).not.toHaveBeenCalled()
        expect(mockRemoveTrack).toHaveBeenCalledOnce()
        expect(result[0].audio).toEqual({
            alreadyTranscoded: true,
            key: "transcoded-sha",
            duration: 180,
            fileSize: 100000,
        })
    })

    it("removes prepared audio when upload fails", async () => {
        mockGetTranscodedUpload.mockRejectedValueOnce(new Error("Not found"))
        mockGetUploadUrlForTranscode.mockResolvedValue({
            uploadId: preparedTrack.sha256,
            uploadUrl: "https://uploads.example.com/audio",
        })
        mockUploadTrack.mockRejectedValueOnce(new Error("Upload failed"))

        await expect(
            importVideo(sdk, mockEnv, cardImport, video.videos),
        ).rejects.toThrow("Upload failed")

        expect(mockRemoveTrack).toHaveBeenCalledWith(
            mockEnv,
            sandboxId,
            preparedTrack,
        )
    })

    it("removes successful downloads when another download fails", async () => {
        const secondTrack = {
            id: "video-2",
            title: "Failed Track",
            url: "https://www.youtube.com/watch?v=video-2",
        }
        mockPrepareTrack
            .mockResolvedValueOnce(preparedTrack)
            .mockRejectedValueOnce(new Error("Download failed"))

        await expect(
            importVideo(sdk, mockEnv, cardImport, [sourceTrack, secondTrack]),
        ).rejects.toThrow("Download failed")

        expect(mockRemoveTrack).toHaveBeenCalledWith(
            mockEnv,
            sandboxId,
            preparedTrack,
        )
        expect(mockUploadTrack).not.toHaveBeenCalled()
    })
})

describe("transcodeAudio", () => {
    it("waits for uploaded audio to finish transcoding", async () => {
        const importedTracks: ImportedTrack[] = [
            {
                index: 0,
                track: sourceTrack,
                audio: {
                    alreadyTranscoded: false,
                    sha256: preparedTrack.sha256,
                },
            },
        ]
        mockGetTranscodedUpload.mockResolvedValue({
            progress: {phase: "complete"},
            transcodedSha256: "transcoded-sha",
            transcodedInfo: {duration: 180, fileSize: 100000},
        })
        vi.spyOn(globalThis, "setTimeout").mockImplementation(
            (callback: TimerHandler) => {
                if (typeof callback === "function") callback()
                return 0 as unknown as ReturnType<typeof setTimeout>
            },
        )

        const result = await transcodeAudio(
            sdk,
            cardImport.cardId,
            importedTracks,
        )

        expect(result).toEqual([
            {
                index: 0,
                track: sourceTrack,
                audio: {
                    key: "transcoded-sha",
                    duration: 180,
                    fileSize: 100000,
                },
            },
        ])
    })
})

describe("updateCard", () => {
    it("adds transcoded tracks to the latest card", async () => {
        const result = await updateCard(sdk, cardImport.cardId, [
            {
                index: 0,
                track: sourceTrack,
                audio: {
                    key: "transcoded-sha",
                    duration: 180,
                    fileSize: 100000,
                },
            },
        ])

        expect(mockGetCard).toHaveBeenCalledWith(cardImport.cardId)
        expect(mockUpdateCard).toHaveBeenCalledWith(
            expect.objectContaining({
                cardId: cardImport.cardId,
                content: expect.objectContaining({
                    chapters: [
                        expect.objectContaining({
                            title: sourceTrack.title,
                            tracks: [
                                expect.objectContaining({
                                    trackUrl: "yoto:#transcoded-sha",
                                }),
                            ],
                        }),
                    ],
                }),
            }),
        )
        expect(result).toEqual({
            status: "success",
            message: "Added 1 track",
            added: 1,
            skipped: 0,
        })
    })

    it("fails before updating when the card no longer exists", async () => {
        mockGetCard.mockResolvedValue(null)

        await expect(updateCard(sdk, cardImport.cardId, [])).rejects.toThrow(
            "Card not found",
        )

        expect(mockUpdateCard).not.toHaveBeenCalled()
    })
})
