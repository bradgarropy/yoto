import {beforeEach, describe, expect, it, vi} from "vitest"

import {createMockEnv} from "~/tests/mocks"

const mockExec = vi.fn()
const mockDestroy = vi.fn()
const mockLoggerInfo = vi.fn()
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

vi.mock("./logger.server", () => ({
    logger: {
        info: (...args: unknown[]) => mockLoggerInfo(...args),
    },
}))

import {
    destroySandbox,
    downloadVideo,
    getPlaylistInfo,
    prepareAudio,
    prepareTrack,
    prepareTracks,
    removeTrack,
    splitAudio,
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

const downloadedAudio = {
    path: "/tmp/video-1.m4a",
    filename: "video-1.m4a",
    contentType: "audio/mp4",
}

const track: Track = {
    ...downloadedAudio,
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
            path: "/tmp/video-1.m4a",
            filename: "video-1.m4a",
            contentType: "audio/mp4",
        })
        expect(mockExec).toHaveBeenNthCalledWith(1, "rm -f '/tmp/video-1.m4a'")
        expect(mockExec).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining(
                "yt-dlp --no-check-certificates --format 'bestaudio[ext=m4a]'",
            ),
        )
        expect(mockLoggerInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                message: "youtube.audio.download.completed",
                durationMs: expect.any(Number),
            }),
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
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.m4a'")
    })
})

describe("splitAudio", () => {
    const chapterTracks = [
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
    ]

    it("splits downloaded audio in track order", async () => {
        mockExec.mockResolvedValue(successfulCommand())

        const result = await splitAudio(
            mockEnv,
            sandboxId,
            downloadedAudio,
            chapterTracks,
        )

        expect(result).toEqual([
            {
                path: "/tmp/video-1-01.m4a",
                filename: "video-1-01.m4a",
                contentType: "audio/mp4",
            },
            {
                path: "/tmp/video-1-02.m4a",
                filename: "video-1-02.m4a",
                contentType: "audio/mp4",
            },
        ])
        expect(mockExec).toHaveBeenNthCalledWith(
            2,
            "ffmpeg -v error -y -ss 0 -i '/tmp/video-1.m4a' -t 60 -map 0:a:0 -c:a copy '/tmp/video-1-01.m4a'",
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            4,
            "ffmpeg -v error -y -ss 60 -i '/tmp/video-1.m4a' -t 120 -map 0:a:0 -c:a copy '/tmp/video-1-02.m4a'",
        )
        expect(mockLoggerInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                message: "audio.split.completed",
                durationMs: expect.any(Number),
            }),
        )
    })

    it("rejects invalid chapter ranges before using the sandbox", async () => {
        await expect(
            splitAudio(mockEnv, sandboxId, downloadedAudio, [
                {...chapterTracks[0], endTime: 0},
            ]),
        ).rejects.toThrow("Invalid chapter range for Chapter One")

        expect(mockGetSandbox).not.toHaveBeenCalled()
    })

    it("removes chapter files when splitting fails", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce({
                success: false,
                stdout: "",
                stderr: "split failed",
            })
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand())

        await expect(
            splitAudio(mockEnv, sandboxId, downloadedAudio, chapterTracks),
        ).rejects.toThrow("Failed to split Chapter Two: split failed")

        expect(mockExec).toHaveBeenNthCalledWith(
            5,
            "rm -f '/tmp/video-1-01.m4a'",
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            6,
            "rm -f '/tmp/video-1-02.m4a'",
        )
    })
})

describe("prepareAudio", () => {
    it("validates and hashes downloaded audio", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand("123456\n"))
            .mockResolvedValueOnce(successfulCommand("180.5\n"))
            .mockResolvedValueOnce(
                successfulCommand(`${"a".repeat(64)}  /tmp/video-1.m4a\n`),
            )

        const result = await prepareAudio(
            mockEnv,
            sandboxId,
            downloadedAudio,
            sourceTrack.title,
        )

        expect(result).toEqual(track)
        expect(mockExec).toHaveBeenNthCalledWith(
            1,
            "stat -c %s '/tmp/video-1.m4a'",
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            2,
            "ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '/tmp/video-1.m4a'",
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            3,
            "sha256sum '/tmp/video-1.m4a'",
        )
        expect(mockLoggerInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                message: "audio.prepare.completed",
                durationMs: expect.any(Number),
            }),
        )
    })

    it("removes downloaded audio when validation fails", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand("invalid\n"))
            .mockResolvedValueOnce(successfulCommand())

        await expect(
            prepareAudio(
                mockEnv,
                sandboxId,
                downloadedAudio,
                sourceTrack.title,
            ),
        ).rejects.toThrow("Failed to measure Test Track: invalid size")
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.m4a'")
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
                successfulCommand(`${"a".repeat(64)}  /tmp/video-1.m4a\n`),
            )

        const result = await prepareTrack(mockEnv, sandboxId, sourceTrack)

        expect(result).toEqual(track)
        expect(mockGetSandbox).toHaveBeenCalledWith(mockEnv.SANDBOX, sandboxId)
        expect(mockExec).toHaveBeenNthCalledWith(1, "rm -f '/tmp/video-1.m4a'")
        expect(mockExec).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("yt-dlp --no-check-certificates"),
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            3,
            "stat -c %s '/tmp/video-1.m4a'",
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            4,
            "ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '/tmp/video-1.m4a'",
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            5,
            "sha256sum '/tmp/video-1.m4a'",
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
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.m4a'")
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
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.m4a'")
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
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.m4a'")
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
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.m4a'")
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
        expect(mockExec).toHaveBeenLastCalledWith("rm -f '/tmp/video-1.m4a'")
    })
})

describe("prepareTracks", () => {
    const chapterTracks = [
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
    ]

    it("downloads once and prepares each chapter in order", async () => {
        mockExec.mockImplementation((command: string) => {
            if (command.startsWith("stat ")) {
                return successfulCommand("123456\n")
            }
            if (command.startsWith("ffprobe ")) {
                return successfulCommand("60\n")
            }
            if (command.startsWith("sha256sum ")) {
                return successfulCommand(`${"a".repeat(64)}  audio.m4a\n`)
            }
            return successfulCommand()
        })

        const result = await prepareTracks(
            mockEnv,
            sandboxId,
            {
                ...sourceTrack,
                duration: 180,
                chapters: [
                    {title: "Chapter One", startTime: 0, endTime: 60},
                    {title: "Chapter Two", startTime: 60, endTime: 180},
                ],
            },
            chapterTracks,
        )

        expect(result).toEqual([
            {
                path: "/tmp/video-1-01.m4a",
                filename: "video-1-01.m4a",
                contentType: "audio/mp4",
                sha256: "a".repeat(64),
                byteLength: 123456,
            },
            {
                path: "/tmp/video-1-02.m4a",
                filename: "video-1-02.m4a",
                contentType: "audio/mp4",
                sha256: "a".repeat(64),
                byteLength: 123456,
            },
        ])

        const commands = mockExec.mock.calls.map(([command]) => command)
        expect(
            commands.filter(command => command.includes("yt-dlp")).length,
        ).toBe(1)
        expect(
            commands.filter(command => command.startsWith("ffmpeg ")).length,
        ).toBe(2)
        expect(commands.at(-1)).toBe("rm -f '/tmp/video-1.m4a'")
    })

    it("uses the existing whole-video preparation path", async () => {
        mockExec.mockImplementation((command: string) => {
            if (command.startsWith("stat ")) {
                return successfulCommand("123456\n")
            }
            if (command.startsWith("ffprobe ")) {
                return successfulCommand("180\n")
            }
            if (command.startsWith("sha256sum ")) {
                return successfulCommand(`${"a".repeat(64)}  audio.m4a\n`)
            }
            return successfulCommand()
        })

        const result = await prepareTracks(
            mockEnv,
            sandboxId,
            {...sourceTrack, duration: 180},
            [
                {
                    id: sourceTrack.id,
                    sourceId: sourceTrack.id,
                    title: sourceTrack.title,
                    url: sourceTrack.url,
                    duration: 180,
                },
            ],
        )

        expect(result).toEqual([track])
        expect(
            mockExec.mock.calls.filter(([command]) =>
                command.startsWith("ffmpeg "),
            ),
        ).toHaveLength(0)
    })

    it("rejects tracks from a different source before downloading", async () => {
        await expect(
            prepareTracks(mockEnv, sandboxId, sourceTrack, [
                {...chapterTracks[0], sourceId: "video-2"},
            ]),
        ).rejects.toThrow("Tracks do not belong to Test Track")

        expect(mockGetSandbox).not.toHaveBeenCalled()
    })

    it("removes the source and chapter files when preparation fails", async () => {
        mockExec.mockImplementation((command: string) => {
            if (command.startsWith("stat ") && command.includes("video-1-02")) {
                return successfulCommand("invalid\n")
            }
            if (command.startsWith("stat ")) {
                return successfulCommand("123456\n")
            }
            if (command.startsWith("ffprobe ")) {
                return successfulCommand("60\n")
            }
            if (command.startsWith("sha256sum ")) {
                return successfulCommand(`${"a".repeat(64)}  audio.m4a\n`)
            }
            return successfulCommand()
        })

        await expect(
            prepareTracks(
                mockEnv,
                sandboxId,
                {...sourceTrack, duration: 180},
                chapterTracks,
            ),
        ).rejects.toThrow("Failed to measure Chapter Two: invalid size")

        const commands = mockExec.mock.calls.map(([command]) => command)
        expect(commands).toContain("rm -f '/tmp/video-1.m4a'")
        expect(commands).toContain("rm -f '/tmp/video-1-01.m4a'")
        expect(commands).toContain("rm -f '/tmp/video-1-02.m4a'")
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
        expect(mockLoggerInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                message: "youtube.inspect.completed",
                durationMs: expect.any(Number),
            }),
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
        expect(command).toContain("--header 'Content-Type: audio/mp4'")
        expect(command).toContain("--upload-file '/tmp/video-1.m4a'")
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
        ).rejects.toThrow("Failed to upload video-1.m4a: HTTP 403")
    })
})

describe("removeTrack", () => {
    it("removes the prepared file from the sandbox", async () => {
        mockExec.mockResolvedValueOnce(successfulCommand())

        await removeTrack(mockEnv, sandboxId, track)

        expect(mockExec).toHaveBeenCalledWith("rm -f '/tmp/video-1.m4a'")
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
