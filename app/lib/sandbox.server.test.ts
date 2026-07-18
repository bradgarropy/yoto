import {beforeEach, describe, expect, it, vi} from "vitest"

import {createMockEnv} from "~/tests/mocks"

const mockExec = vi.fn()
const mockDestroy = vi.fn()
const mockGetSandbox = vi.fn<
    (
        binding: unknown,
        id: string,
    ) => {
        destroy: typeof mockDestroy
        exec: typeof mockExec
    }
>(() => ({destroy: mockDestroy, exec: mockExec}))

vi.mock("@cloudflare/sandbox", () => ({
    getSandbox: (...args: [unknown, string]) => mockGetSandbox(...args),
}))

import {
    destroySandbox,
    downloadVideo,
    getPlaylistInfo,
    prepareTrack,
    removeTrack,
    type Track,
    uploadTrack,
} from "./sandbox.server"

const mockEnv = createMockEnv()
const sandboxId = "import-test-job"

const sourceTrack = {
    id: "video-1",
    title: "Test Track",
    url: "https://www.youtube.com/watch?v=video-1",
}

const track: Track = {
    path: "/tmp/video-1.mp3",
    filename: "video-1.mp3",
    sha256: "a".repeat(64),
    byteLength: 123456,
}

const successfulCommand = (stdout = "") => ({
    success: true,
    stdout,
    stderr: "",
})

beforeEach(() => {
    vi.clearAllMocks()
})

describe("downloadVideo", () => {
    it("downloads audio into the sandbox", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand())

        const result = await downloadVideo(mockEnv, sandboxId, sourceTrack)

        expect(result).toEqual({
            path: "/tmp/video-1.mp3",
            filename: "video-1.mp3",
        })
        expect(mockExec).toHaveBeenNthCalledWith(1, "rm -f '/tmp/video-1.mp3'")
        expect(mockExec).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("yt-dlp --no-check-certificates"),
        )
    })

    it("removes a partial download when it fails", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce({
                success: false,
                stdout: "",
                stderr: "download failed",
            })
            .mockResolvedValueOnce(successfulCommand())

        await expect(
            downloadVideo(mockEnv, sandboxId, sourceTrack),
        ).rejects.toThrow("Failed to download Test Track: download failed")
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.mp3'")
    })
})

describe("prepareTrack", () => {
    it("rejects known long tracks before downloading", async () => {
        await expect(
            prepareTrack(mockEnv, sandboxId, {
                ...sourceTrack,
                duration: 3600.1,
            }),
        ).rejects.toThrow(
            "Test Track is too long for Yoto. Tracks must be 60 minutes or shorter.",
        )

        expect(mockGetSandbox).not.toHaveBeenCalled()
        expect(mockExec).not.toHaveBeenCalled()
    })

    it("downloads a track and returns its sandbox metadata", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand("123456\n"))
            .mockResolvedValueOnce(successfulCommand("180.5\n"))
            .mockResolvedValueOnce(
                successfulCommand(`${"a".repeat(64)}  /tmp/video-1.mp3\n`),
            )

        const result = await prepareTrack(mockEnv, sandboxId, sourceTrack)

        expect(result).toEqual(track)
        expect(mockGetSandbox).toHaveBeenCalledWith(mockEnv.SANDBOX, sandboxId)
        expect(mockExec).toHaveBeenNthCalledWith(1, "rm -f '/tmp/video-1.mp3'")
        expect(mockExec).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("yt-dlp --no-check-certificates"),
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            3,
            "stat -c %s '/tmp/video-1.mp3'",
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            4,
            "ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '/tmp/video-1.mp3'",
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            5,
            "sha256sum '/tmp/video-1.mp3'",
        )
    })

    it("removes a partial file when preparation fails", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce({
                success: false,
                stdout: "",
                stderr: "download failed",
            })
            .mockResolvedValueOnce(successfulCommand())

        await expect(
            prepareTrack(mockEnv, sandboxId, sourceTrack),
        ).rejects.toThrow("Failed to download Test Track: download failed")
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.mp3'")
    })

    it("rejects invalid file metadata and removes the file", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand("123456\n"))
            .mockResolvedValueOnce(successfulCommand("180.5\n"))
            .mockResolvedValueOnce(successfulCommand("not-a-hash\n"))
            .mockResolvedValueOnce(successfulCommand())

        await expect(
            prepareTrack(mockEnv, sandboxId, sourceTrack),
        ).rejects.toThrow("Failed to hash Test Track: invalid SHA-256")
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.mp3'")
    })

    it("rejects tracks longer than Yoto's limit", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand("99999999\n"))
            .mockResolvedValueOnce(successfulCommand("3600.1\n"))
            .mockResolvedValueOnce(successfulCommand())

        await expect(
            prepareTrack(mockEnv, sandboxId, sourceTrack),
        ).rejects.toThrow(
            "Test Track is too long for Yoto. Tracks must be 60 minutes or shorter.",
        )
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.mp3'")
    })

    it("rejects tracks larger than Yoto's limit", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand("100000001\n"))
            .mockResolvedValueOnce(successfulCommand("3600\n"))
            .mockResolvedValueOnce(successfulCommand())

        await expect(
            prepareTrack(mockEnv, sandboxId, sourceTrack),
        ).rejects.toThrow(
            "Test Track is too large for Yoto. Tracks must be 100 MB or smaller.",
        )
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.mp3'")
    })

    it("reports both limits when a track exceeds both", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand("100000001\n"))
            .mockResolvedValueOnce(successfulCommand("3600.1\n"))
            .mockResolvedValueOnce(successfulCommand())

        await expect(
            prepareTrack(mockEnv, sandboxId, sourceTrack),
        ).rejects.toThrow(
            "Test Track is too long and too large for Yoto. Tracks must be 60 minutes or shorter and 100 MB or smaller.",
        )
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.mp3'")
    })
})

describe("getPlaylistInfo", () => {
    it("includes duration and chapter markers for a video", async () => {
        mockExec.mockResolvedValueOnce(
            successfulCommand(
                JSON.stringify({
                    id: "video-1",
                    title: "Test Track",
                    duration: 180.5,
                    chapters: [
                        {
                            title: "Chapter One",
                            start_time: 0,
                            end_time: 90,
                        },
                        {
                            title: "Chapter Two",
                            start_time: 90,
                            end_time: 180.5,
                        },
                    ],
                }),
            ),
        )

        const result = await getPlaylistInfo(
            mockEnv,
            sandboxId,
            sourceTrack.url,
        )

        expect(result.videos).toEqual([
            {
                ...sourceTrack,
                duration: 180.5,
                chapters: [
                    {
                        title: "Chapter One",
                        startTime: 0,
                        endTime: 90,
                    },
                    {
                        title: "Chapter Two",
                        startTime: 90,
                        endTime: 180.5,
                    },
                ],
            },
        ])
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining("--dump-single-json"),
        )
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining("--skip-download --no-playlist"),
        )
    })

    it("rejects malformed video JSON", async () => {
        mockExec.mockResolvedValueOnce(successfulCommand("not-json"))

        await expect(
            getPlaylistInfo(mockEnv, sandboxId, sourceTrack.url),
        ).rejects.toThrow("Failed to parse video info")
    })
})

describe("uploadTrack", () => {
    it("uploads from the sandbox without putting the signed URL in the command", async () => {
        const uploadUrl =
            "https://uploads.example.com/audio?signature=super-secret"
        mockExec.mockResolvedValueOnce(successfulCommand())

        await uploadTrack(mockEnv, sandboxId, track, uploadUrl)

        expect(mockExec).toHaveBeenCalledOnce()
        const [command, options] = mockExec.mock.calls[0]
        expect(command).toContain("curl --fail --silent --show-error")
        expect(command).toContain("--upload-file '/tmp/video-1.mp3'")
        expect(command).toContain('"$YOTO_UPLOAD_URL"')
        expect(command).not.toContain(uploadUrl)
        expect(options).toEqual({env: {YOTO_UPLOAD_URL: uploadUrl}})
    })

    it("rejects non-HTTPS upload URLs before calling the sandbox", async () => {
        await expect(
            uploadTrack(
                mockEnv,
                sandboxId,
                track,
                "http://uploads.example.com/audio",
            ),
        ).rejects.toThrow("Invalid Yoto upload URL")

        expect(mockGetSandbox).not.toHaveBeenCalled()
        expect(mockExec).not.toHaveBeenCalled()
    })

    it("reports failed sandbox uploads", async () => {
        mockExec.mockResolvedValueOnce({
            success: false,
            stdout: "",
            stderr: "HTTP 403",
        })

        await expect(
            uploadTrack(
                mockEnv,
                sandboxId,
                track,
                "https://uploads.example.com/audio",
            ),
        ).rejects.toThrow("Failed to upload video-1.mp3: HTTP 403")
    })
})

describe("removeTrack", () => {
    it("removes the prepared file from the sandbox", async () => {
        mockExec.mockResolvedValueOnce(successfulCommand())

        await removeTrack(mockEnv, sandboxId, track)

        expect(mockExec).toHaveBeenCalledWith("rm -f '/tmp/video-1.mp3'")
    })
})

describe("destroySandbox", () => {
    it("destroys the import sandbox", async () => {
        mockDestroy.mockResolvedValueOnce(undefined)

        await destroySandbox(mockEnv, sandboxId)

        expect(mockGetSandbox).toHaveBeenCalledWith(mockEnv.SANDBOX, sandboxId)
        expect(mockDestroy).toHaveBeenCalledOnce()
    })
})
