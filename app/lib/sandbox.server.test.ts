import {beforeEach, describe, expect, it, vi} from "vitest"

const mockExec = vi.fn()
const mockGetSandbox = vi.fn(() => ({exec: mockExec}))

vi.mock("@cloudflare/sandbox", () => ({
    getSandbox: (...args: unknown[]) => mockGetSandbox(...args),
}))

import {
    prepareTrack,
    removeTrack,
    type Track,
    uploadTrack,
} from "./sandbox.server"

const mockEnv = {
    YOTO_AUTH_SECRET: "test-secret-key-for-testing",
    RESEND_API_KEY: "test-resend-api-key",
    SANDBOX: {} as Env["SANDBOX"],
}

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

describe("prepareTrack", () => {
    it("downloads a track and returns its sandbox metadata", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(
                successfulCommand(`${"a".repeat(64)}  /tmp/video-1.mp3\n`),
            )
            .mockResolvedValueOnce(successfulCommand("123456\n"))

        const result = await prepareTrack(mockEnv, sourceTrack)

        expect(result).toEqual(track)
        expect(mockGetSandbox).toHaveBeenCalledWith(
            mockEnv.SANDBOX,
            "sync-worker",
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            1,
            "rm -f '/tmp/video-1.mp3'",
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("yt-dlp --no-check-certificates"),
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            3,
            "sha256sum '/tmp/video-1.mp3'",
        )
        expect(mockExec).toHaveBeenNthCalledWith(
            4,
            "stat -c %s '/tmp/video-1.mp3'",
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

        await expect(prepareTrack(mockEnv, sourceTrack)).rejects.toThrow(
            "Failed to download Test Track: download failed",
        )
        expect(mockExec).toHaveBeenLastCalledWith(
            "rm -f '/tmp/video-1.mp3'",
        )
    })

    it("rejects invalid file metadata and removes the file", async () => {
        mockExec
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand())
            .mockResolvedValueOnce(successfulCommand("not-a-hash\n"))
            .mockResolvedValueOnce(successfulCommand())

        await expect(prepareTrack(mockEnv, sourceTrack)).rejects.toThrow(
            "Failed to hash Test Track: invalid SHA-256",
        )
        expect(mockExec).toHaveBeenLastCalledWith(
            "rm -f '/tmp/video-1.mp3'",
        )
    })
})

describe("uploadTrack", () => {
    it("uploads from the sandbox without putting the signed URL in the command", async () => {
        const uploadUrl =
            "https://uploads.example.com/audio?signature=super-secret"
        mockExec.mockResolvedValueOnce(successfulCommand())

        await uploadTrack(mockEnv, track, uploadUrl)

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
            uploadTrack(mockEnv, track, "http://uploads.example.com/audio"),
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
                track,
                "https://uploads.example.com/audio",
            ),
        ).rejects.toThrow("Failed to upload video-1.mp3: HTTP 403")
    })
})

describe("removeTrack", () => {
    it("removes the prepared file from the sandbox", async () => {
        mockExec.mockResolvedValueOnce(successfulCommand())

        await removeTrack(mockEnv, track)

        expect(mockExec).toHaveBeenCalledWith("rm -f '/tmp/video-1.mp3'")
    })
})
