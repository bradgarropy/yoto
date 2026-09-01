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
    assertCardCapacity,
    CardCapacityError,
    createAudioTracks,
    inspectVideo,
    processAudio,
    updateCard,
    YOTO_CARD_TRACK_LIMIT,
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

describe("assertCardCapacity", () => {
    it("allows imports that fill the card exactly", () => {
        expect(() => assertCardCapacity(58, 42)).not.toThrow()
    })

    it("rejects imports that exceed the card limit", () => {
        expect(() => assertCardCapacity(58, 43)).toThrow(
            "This import would exceed Yoto's 100-track card limit. This card has 58 tracks and the import contains 43 tracks.",
        )
    })

    it("includes both track counts in the capacity error", () => {
        try {
            assertCardCapacity(0, YOTO_CARD_TRACK_LIMIT + 1)
            expect.unreachable("Expected the capacity check to fail")
        } catch (error) {
            expect(error).toBeInstanceOf(CardCapacityError)
            expect(error).toMatchObject({
                existingTrackCount: 0,
                incomingTrackCount: 101,
            })
        }
    })
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

describe("processAudio", () => {
    it("reuses cached audio without uploading or polling", async () => {
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
        expect(mockGetTranscodedUpload).toHaveBeenCalledOnce()
        expect(mockRemoveTrack).toHaveBeenCalledWith(
            mockEnv,
            sandboxId,
            preparedTrack,
        )
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

    it("uploads, transcodes, and removes prepared audio", async () => {
        mockGetTranscodedUpload
            .mockRejectedValueOnce(new Error("Not found"))
            .mockResolvedValueOnce({
                progress: {phase: "complete"},
                transcodedSha256: "transcoded-sha",
                transcodedInfo: {duration: 180, fileSize: 100000},
            })
        mockGetUploadUrlForTranscode.mockResolvedValue({
            uploadId: preparedTrack.sha256,
            uploadUrl: "https://uploads.example.com/audio",
        })

        const result = await processAudio(
            sdk,
            mockEnv,
            cardImport,
            video.videos,
        )

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
        expect(result[0].audio).toEqual({
            key: "transcoded-sha",
            duration: 180,
            fileSize: 100000,
        })
    })

    it("pipelines a prepared source while another source is downloading", async () => {
        const secondVideo = {
            id: "video-2",
            title: "Second Track",
            url: "https://www.youtube.com/watch?v=video-2",
            duration: 120,
        }
        const secondPreparedTrack = {
            ...preparedTrack,
            path: "/tmp/video-2.m4a",
            filename: "video-2.m4a",
            sha256: "b".repeat(64),
        }
        let resolveSecondPreparation:
            | ((tracks: (typeof secondPreparedTrack)[]) => void)
            | undefined
        const secondPreparation = new Promise<(typeof secondPreparedTrack)[]>(
            resolve => {
                resolveSecondPreparation = resolve
            },
        )
        mockPrepareTracks
            .mockResolvedValueOnce([preparedTrack])
            .mockReturnValueOnce(secondPreparation)
        const transcodeCalls = new Map<string, number>()
        mockGetTranscodedUpload.mockImplementation((sha256: string) => {
            const calls = (transcodeCalls.get(sha256) ?? 0) + 1
            transcodeCalls.set(sha256, calls)
            if (calls === 1) return Promise.reject(new Error("Not found"))
            return Promise.resolve({
                progress: {phase: "complete"},
                transcodedSha256: `transcoded-${sha256}`,
                transcodedInfo: {duration: 180, fileSize: 100000},
            })
        })
        mockGetUploadUrlForTranscode.mockImplementation((sha256: string) => ({
            uploadId: sha256,
            uploadUrl: `https://uploads.example.com/${sha256}`,
        }))

        const resultPromise = processAudio(sdk, mockEnv, cardImport, [
            sourceTrack,
            secondVideo,
        ])

        await vi.waitFor(() => expect(mockUploadTrack).toHaveBeenCalledOnce())
        expect(mockUploadTrack).toHaveBeenCalledWith(
            mockEnv,
            sandboxId,
            preparedTrack,
            expect.any(String),
        )

        resolveSecondPreparation?.([secondPreparedTrack])
        const result = await resultPromise

        expect(mockUploadTrack).toHaveBeenCalledTimes(2)
        expect(result.map(track => track.track.id)).toEqual([
            sourceTrack.id,
            secondVideo.id,
        ])
    })

    it("prepares one source once and preserves chapter order", async () => {
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
        const transcodeCalls = new Map<string, number>()
        mockGetTranscodedUpload.mockImplementation((sha256: string) => {
            const calls = (transcodeCalls.get(sha256) ?? 0) + 1
            transcodeCalls.set(sha256, calls)
            if (calls === 1) return Promise.reject(new Error("Not found"))
            return Promise.resolve({
                progress: {phase: "complete"},
                transcodedSha256: `transcoded-${sha256}`,
                transcodedInfo: {duration: 180, fileSize: 100000},
            })
        })
        mockGetUploadUrlForTranscode.mockImplementation((sha256: string) => ({
            uploadId: sha256,
            uploadUrl: `https://uploads.example.com/${sha256}`,
        }))

        const result = await processAudio(
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
        expect(result.map(track => track.track)).toEqual(chapterTracks)
    })

    it("removes prepared audio when upload fails", async () => {
        mockGetTranscodedUpload.mockRejectedValueOnce(new Error("Not found"))
        mockGetUploadUrlForTranscode.mockResolvedValue({
            uploadId: preparedTrack.sha256,
            uploadUrl: "https://uploads.example.com/audio",
        })
        mockUploadTrack.mockRejectedValueOnce(new Error("Upload failed"))

        await expect(
            processAudio(sdk, mockEnv, cardImport, video.videos),
        ).rejects.toThrow("Upload failed")

        expect(mockRemoveTrack).toHaveBeenCalledWith(
            mockEnv,
            sandboxId,
            preparedTrack,
        )
    })

    it("limits concurrent Yoto polling while preserving source order", async () => {
        const videos = Array.from({length: 6}, (_, index) => ({
            id: `video-${index}`,
            title: `Track ${index}`,
            url: `https://www.youtube.com/watch?v=video-${index}`,
            duration: 180,
        }))
        mockPrepareTracks.mockImplementation(
            async (_env, _sandboxId, source) => [
                {
                    ...preparedTrack,
                    path: `/tmp/${source.id}.m4a`,
                    filename: `${source.id}.m4a`,
                    sha256: `sha-${source.id}`,
                },
            ],
        )
        mockGetUploadUrlForTranscode.mockImplementation((sha256: string) => ({
            uploadId: sha256,
            uploadUrl: null,
        }))
        const requestCounts = new Map<string, number>()
        let activePolls = 0
        let maxActivePolls = 0
        const realSetTimeout = globalThis.setTimeout
        mockGetTranscodedUpload.mockImplementation(async (sha256: string) => {
            const count = (requestCounts.get(sha256) ?? 0) + 1
            requestCounts.set(sha256, count)
            if (count === 1) throw new Error("Not found")

            activePolls++
            maxActivePolls = Math.max(maxActivePolls, activePolls)
            await new Promise(resolve => realSetTimeout(resolve, 0))
            activePolls--

            return count === 2
                ? {progress: {phase: "transcoding"}}
                : {
                      progress: {phase: "complete"},
                      transcodedSha256: `transcoded-${sha256}`,
                      transcodedInfo: {duration: 180, fileSize: 100000},
                  }
        })
        vi.spyOn(globalThis, "setTimeout").mockImplementation(
            (callback: TimerHandler) => {
                if (typeof callback === "function") callback()
                return 0 as unknown as ReturnType<typeof setTimeout>
            },
        )

        const result = await processAudio(sdk, mockEnv, cardImport, videos)

        expect(maxActivePolls).toBe(5)
        expect([...requestCounts.values()]).toEqual(Array(6).fill(3))
        expect(result.map(track => track.track.id)).toEqual(
            videos.map(video => video.id),
        )
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
