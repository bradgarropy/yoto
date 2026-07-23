import type {YotoSdk} from "@yotoplay/yoto-sdk"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {createMockEnv} from "~/tests/mocks"

const mockGetPlaylistInfo = vi.fn()
const mockPrepareTracks = vi.fn()
const mockRemoveTrack = vi.fn()
const mockUploadTrack = vi.fn()

vi.mock("./sandbox.server", () => ({
    getPlaylistInfo: (...args: unknown[]) => mockGetPlaylistInfo(...args),
    prepareTracks: (...args: unknown[]) => mockPrepareTracks(...args),
    removeTrack: (...args: unknown[]) => mockRemoveTrack(...args),
    uploadTrack: (...args: unknown[]) => mockUploadTrack(...args),
}))

import {
    createAudioTracks,
    type ImportedTrack,
    importVideo,
    inspectVideo,
    processAudio,
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
    path: "/tmp/video-1.m4a",
    filename: "video-1.m4a",
    contentType: "audio/mp4",
    sha256: "a".repeat(64),
    byteLength: 123456,
}
const audioTrack = {
    id: sourceTrack.id,
    sourceId: sourceTrack.id,
    title: sourceTrack.title,
    url: sourceTrack.url,
    duration: sourceTrack.duration,
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
    vi.spyOn(console, "debug").mockImplementation(() => {})
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
    mockPrepareTracks.mockResolvedValue([preparedTrack])
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

        expect(onProgress).toHaveBeenCalledWith({
            phase: "preparing",
            percent: 0,
            total: 0,
            prepared: 0,
            uploaded: 0,
            ready: 0,
        })
        expect(mockGetPlaylistInfo).toHaveBeenCalledWith(
            mockEnv,
            sandboxId,
            cardImport.youtubeUrl,
        )
        expect(mockPrepareTracks).not.toHaveBeenCalled()
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
        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                message: "yoto.audio.upload.completed",
                durationMs: expect.any(Number),
            }),
        )
        expect(result).toEqual([
            {
                index: 0,
                track: audioTrack,
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

    it("prepares and uploads each chapter from one source video", async () => {
        const videoWithChapters = {
            ...sourceTrack,
            chapters: [
                {title: "Chapter One", startTime: 0, endTime: 60},
                {title: "Chapter Two", startTime: 60, endTime: 180},
            ],
        }
        const chapterTracks = createAudioTracks([videoWithChapters], true)
        const preparedChapters = chapterTracks.map((track, index) => ({
            path: `/tmp/${track.id}.m4a`,
            filename: `${track.id}.m4a`,
            contentType: "audio/mp4",
            sha256: String(index + 1).repeat(64),
            byteLength: 123456,
        }))
        mockPrepareTracks.mockResolvedValueOnce(preparedChapters)
        mockGetTranscodedUpload.mockRejectedValue(new Error("Not found"))
        mockGetUploadUrlForTranscode.mockImplementation((sha256: string) => ({
            uploadId: sha256,
            uploadUrl: `https://uploads.example.com/${sha256}`,
        }))

        const result = await importVideo(
            sdk,
            mockEnv,
            {...cardImport, splitByChapters: true},
            [videoWithChapters],
        )

        expect(mockPrepareTracks).toHaveBeenCalledExactlyOnceWith(
            mockEnv,
            sandboxId,
            videoWithChapters,
            chapterTracks,
        )
        expect(mockUploadTrack).toHaveBeenCalledTimes(2)
        expect(result.map(({index, track}) => ({index, track}))).toEqual([
            {index: 0, track: chapterTracks[0]},
            {index: 1, track: chapterTracks[1]},
        ])
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
        mockPrepareTracks
            .mockResolvedValueOnce([preparedTrack])
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
    it("checks uploaded audio immediately", async () => {
        const importedTracks: ImportedTrack[] = [
            {
                index: 0,
                track: audioTrack,
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
        const setTimeoutSpy = vi
            .spyOn(globalThis, "setTimeout")
            .mockImplementation((callback: TimerHandler) => {
                if (typeof callback === "function") callback()
                return 0 as unknown as ReturnType<typeof setTimeout>
            })

        const result = await transcodeAudio(sdk, cardImport, importedTracks)

        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                message: "yoto.audio.transcode.completed",
                durationMs: expect.any(Number),
            }),
        )
        expect(mockGetTranscodedUpload).toHaveBeenCalledTimes(1)
        expect(setTimeoutSpy).not.toHaveBeenCalled()
        expect(result).toEqual([
            {
                index: 0,
                track: audioTrack,
                audio: {
                    key: "transcoded-sha",
                    duration: 180,
                    fileSize: 100000,
                },
            },
        ])
    })

    it("polls every pending track before waiting for the next round", async () => {
        const importedTracks: ImportedTrack[] = Array.from(
            {length: 6},
            (_, index) => ({
                index,
                track: {
                    ...audioTrack,
                    id: `video-${index}`,
                    title: `Track ${index}`,
                },
                audio: {
                    alreadyTranscoded: false,
                    sha256: `sha-${index}`,
                },
            }),
        )
        const pollCounts = new Map<string, number>()
        let activePolls = 0
        let maxActivePolls = 0

        mockGetTranscodedUpload.mockImplementation(async (sha256: string) => {
            activePolls++
            maxActivePolls = Math.max(maxActivePolls, activePolls)
            await Promise.resolve()
            activePolls--

            const pollCount = (pollCounts.get(sha256) ?? 0) + 1
            pollCounts.set(sha256, pollCount)
            return pollCount === 1
                ? {progress: {phase: "transcoding"}}
                : {
                      progress: {phase: "complete"},
                      transcodedSha256: `transcoded-${sha256}`,
                      transcodedInfo: {duration: 180, fileSize: 100000},
                  }
        })

        const callsBeforeWait: number[] = []
        vi.spyOn(globalThis, "setTimeout").mockImplementation(
            (callback: TimerHandler) => {
                callsBeforeWait.push(mockGetTranscodedUpload.mock.calls.length)
                if (typeof callback === "function") callback()
                return 0 as unknown as ReturnType<typeof setTimeout>
            },
        )

        const result = await transcodeAudio(sdk, cardImport, importedTracks)

        expect(callsBeforeWait[0]).toBe(6)
        expect(mockGetTranscodedUpload).toHaveBeenCalledTimes(12)
        expect(maxActivePolls).toBe(5)
        expect(result.map(track => track.track.id)).toEqual(
            importedTracks.map(track => track.track.id),
        )
    })
})

describe("processAudio", () => {
    it("imports and resolves every track before returning", async () => {
        mockGetTranscodedUpload.mockResolvedValue({
            progress: {phase: "complete"},
            transcodedSha256: "transcoded-sha",
            transcodedInfo: {duration: 180, fileSize: 100000},
        })

        const result = await processAudio(
            sdk,
            mockEnv,
            cardImport,
            video.videos,
        )

        expect(mockPrepareTracks).toHaveBeenCalledOnce()
        expect(mockUploadTrack).not.toHaveBeenCalled()
        expect(result).toEqual([
            {
                index: 0,
                track: audioTrack,
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
        const onProgress = vi.fn()
        const result = await updateCard(
            sdk,
            cardImport,
            [
                {
                    index: 0,
                    track: audioTrack,
                    audio: {
                        key: "transcoded-sha",
                        duration: 180,
                        fileSize: 100000,
                    },
                },
            ],
            onProgress,
        )

        expect(mockGetCard).toHaveBeenCalledWith(cardImport.cardId)
        expect(onProgress).toHaveBeenNthCalledWith(1, {
            phase: "finalizing",
            percent: 95,
            total: 1,
            prepared: 1,
            uploaded: 1,
            ready: 1,
        })
        expect(onProgress).toHaveBeenNthCalledWith(2, {
            phase: "finalizing",
            percent: 100,
            total: 1,
            prepared: 1,
            uploaded: 1,
            ready: 1,
        })
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

        await expect(updateCard(sdk, cardImport, [])).rejects.toThrow(
            "Card not found",
        )

        expect(mockUpdateCard).not.toHaveBeenCalled()
    })
})
