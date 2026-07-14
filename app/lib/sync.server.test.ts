import type {YotoSdk} from "@yotoplay/yoto-sdk"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mockGetPlaylistInfo = vi.fn()
const mockPrepareTrack = vi.fn()
const mockUploadTrack = vi.fn()
const mockRemoveTrack = vi.fn()

vi.mock("./sandbox.server", () => ({
    getPlaylistInfo: (...args: unknown[]) => mockGetPlaylistInfo(...args),
    prepareTrack: (...args: unknown[]) => mockPrepareTrack(...args),
    uploadTrack: (...args: unknown[]) => mockUploadTrack(...args),
    removeTrack: (...args: unknown[]) => mockRemoveTrack(...args),
}))

import {performSyncToCard} from "./sync.server"

const mockEnv = {
    YOTO_AUTH_SECRET: "test-secret-key-for-testing",
    RESEND_API_KEY: "test-resend-api-key",
    SANDBOX: {} as Env["SANDBOX"],
}
const sandboxId = "upload-test-job"

const sourceTrack = {
    id: "video-1",
    title: "Test Track",
    url: "https://www.youtube.com/watch?v=video-1",
}
const preparedTrack = {
    path: "/tmp/video-1.mp3",
    filename: "video-1.mp3",
    sha256: "a".repeat(64),
    byteLength: 123456,
}

const mockGetCard = vi.fn()
const mockUpdateCard = vi.fn()
const mockGetTranscodedUpload = vi.fn()
const mockGetUploadUrlForTranscode = vi.fn()
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

    mockGetPlaylistInfo.mockResolvedValue({
        id: "video-1",
        title: "Test Track",
        videos: [sourceTrack],
    })
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
    mockUploadTrack.mockResolvedValue(undefined)
    mockRemoveTrack.mockResolvedValue(undefined)
    mockUpdateCard.mockResolvedValue(undefined)
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("performSyncToCard", () => {
    it("uploads prepared audio directly from the sandbox and removes it", async () => {
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
        vi.spyOn(globalThis, "setTimeout").mockImplementation(((
            callback: TimerHandler,
        ) => {
            if (typeof callback === "function") callback()
            return 0 as unknown as ReturnType<typeof setTimeout>
        }) as unknown as typeof setTimeout)

        const result = await performSyncToCard(
            sdk,
            mockEnv,
            sandboxId,
            sourceTrack.url,
            "card-1",
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
        expect(mockUpdateCard).toHaveBeenCalledOnce()
        expect(result).toEqual({
            success: true,
            message: "Added 1 track",
            added: 1,
            skipped: 0,
        })
    })

    it("removes prepared audio when the direct upload fails", async () => {
        mockGetTranscodedUpload.mockRejectedValueOnce(new Error("Not found"))
        mockGetUploadUrlForTranscode.mockResolvedValue({
            uploadId: preparedTrack.sha256,
            uploadUrl: "https://uploads.example.com/audio",
        })
        mockUploadTrack.mockRejectedValueOnce(new Error("Upload failed"))

        const result = await performSyncToCard(
            sdk,
            mockEnv,
            sandboxId,
            sourceTrack.url,
            "card-1",
        )

        expect(mockRemoveTrack).toHaveBeenCalledWith(
            mockEnv,
            sandboxId,
            preparedTrack,
        )
        expect(mockUpdateCard).not.toHaveBeenCalled()
        expect(result).toEqual({error: "Upload failed"})
    })

    it("removes successful downloads when another download fails", async () => {
        const secondTrack = {
            id: "video-2",
            title: "Failed Track",
            url: "https://www.youtube.com/watch?v=video-2",
        }
        mockGetPlaylistInfo.mockResolvedValue({
            id: "playlist-1",
            title: "Test Playlist",
            videos: [sourceTrack, secondTrack],
        })
        mockPrepareTrack
            .mockResolvedValueOnce(preparedTrack)
            .mockRejectedValueOnce(new Error("Download failed"))

        const result = await performSyncToCard(
            sdk,
            mockEnv,
            sandboxId,
            "https://www.youtube.com/playlist?list=playlist-1",
            "card-1",
        )

        expect(mockRemoveTrack).toHaveBeenCalledWith(
            mockEnv,
            sandboxId,
            preparedTrack,
        )
        expect(mockUploadTrack).not.toHaveBeenCalled()
        expect(result).toEqual({error: "Download failed"})
    })
})
