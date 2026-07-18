// Sandbox client for calling yt-dlp operations via Durable Object
// Uses the sandbox endpoints defined in workers/app.ts

import {getSandbox} from "@cloudflare/sandbox"
import shellEscape from "shell-escape"

import type {
    YouTubeChapter,
    YouTubePlaylistInfo,
    YouTubeVideo,
} from "./youtube.server"

type Track = {
    path: string
    filename: string
    sha256: string
    byteLength: number
}

type DownloadedAudio = {
    path: string
    filename: string
}

const MAX_TRACK_BYTES = 100_000_000
const MAX_TRACK_DURATION_SECONDS = 60 * 60

// Validate that a URL is a legitimate YouTube URL
function isYoutubeUrl(url: string): boolean {
    const youtubePatterns = [
        /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
        /^https?:\/\/(www\.)?youtube\.com\/playlist\?list=[\w-]+/,
        /^https?:\/\/youtu\.be\/[\w-]+/,
    ]
    return youtubePatterns.some(pattern => pattern.test(url))
}

// Escape a single argument for safe shell interpolation
function escapeShellArg(arg: string): string {
    return shellEscape([arg])
}

function parseDuration(value: string | undefined): number | undefined {
    if (!value) return undefined

    const duration = Number.parseFloat(value)
    return Number.isFinite(duration) && duration >= 0 ? duration : undefined
}

function parseVideoInfo(value: string): YouTubeVideo {
    let metadata: unknown
    try {
        metadata = JSON.parse(value)
    } catch {
        throw new Error("Failed to parse video info")
    }

    if (!metadata || typeof metadata !== "object") {
        throw new Error("Failed to parse video info")
    }

    const video = metadata as Record<string, unknown>
    if (typeof video.id !== "string" || typeof video.title !== "string") {
        throw new Error("Failed to parse video info")
    }

    const duration =
        typeof video.duration === "number" &&
        Number.isFinite(video.duration) &&
        video.duration >= 0
            ? video.duration
            : undefined

    const chapters = Array.isArray(video.chapters)
        ? video.chapters.flatMap((value): YouTubeChapter[] => {
              if (!value || typeof value !== "object") return []

              const chapter = value as Record<string, unknown>
              if (
                  typeof chapter.title !== "string" ||
                  typeof chapter.start_time !== "number" ||
                  typeof chapter.end_time !== "number" ||
                  !Number.isFinite(chapter.start_time) ||
                  !Number.isFinite(chapter.end_time) ||
                  chapter.start_time < 0 ||
                  chapter.end_time <= chapter.start_time
              ) {
                  return []
              }

              return [
                  {
                      title: chapter.title,
                      startTime: chapter.start_time,
                      endTime: chapter.end_time,
                  },
              ]
          })
        : undefined

    return {
        id: video.id,
        title: video.title,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        duration,
        chapters,
    }
}

// Get playlist/video info from YouTube via sandbox
async function getPlaylistInfo(
    env: Env,
    sandboxId: string,
    url: string,
): Promise<YouTubePlaylistInfo> {
    // Validate URL before processing
    if (!isYoutubeUrl(url)) {
        throw new Error("Invalid YouTube URL")
    }

    const sandbox = getSandbox(env.SANDBOX, sandboxId)
    const escapedUrl = escapeShellArg(url)

    // Detect if URL is a playlist
    const isPlaylist = url.includes("list=")

    if (isPlaylist) {
        const result = await sandbox.exec(
            `yt-dlp --no-check-certificates --flat-playlist --print "%(playlist_id)s\t%(playlist_title)s\t%(id)s\t%(title)s\t%(duration)s" ${escapedUrl}`,
        )

        if (!result.success) {
            throw new Error(`Failed to get playlist info: ${result.stderr}`)
        }

        const lines = result.stdout.trim().split("\n").filter(Boolean)
        if (lines.length === 0) {
            throw new Error("No tracks found in playlist")
        }

        // Parse first line to get playlist info
        const [playlistId, playlistTitle] = lines[0].split("\t")

        const videos: YouTubeVideo[] = lines.map(line => {
            const [, , videoId, title, duration] = line.split("\t")
            return {
                id: videoId,
                title,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                duration: parseDuration(duration),
            }
        })

        return {id: playlistId, title: playlistTitle, videos}
    } else {
        const result = await sandbox.exec(
            `yt-dlp --no-check-certificates --dump-single-json ` +
                `--skip-download --no-playlist ${escapedUrl}`,
        )

        if (!result.success) {
            throw new Error(`Failed to get video info: ${result.stderr}`)
        }

        const output = result.stdout.trim()
        if (!output) {
            throw new Error("No video info found")
        }

        const video = parseVideoInfo(output)

        return {
            id: video.id,
            title: video.title,
            videos: [video],
        }
    }
}

// Download a video's audio and leave it in the sandbox
async function downloadVideo(
    env: Env,
    sandboxId: string,
    video: YouTubeVideo,
): Promise<DownloadedAudio> {
    const sandbox = getSandbox(env.SANDBOX, sandboxId)
    const filename = `${video.id}.mp3`
    const path = `/tmp/${filename}`
    const escapedPath = escapeShellArg(path)
    const escapedUrl = escapeShellArg(video.url)

    // Remove files left behind by an interrupted attempt for the same video.
    await sandbox.exec(`rm -f ${escapedPath}`)

    try {
        const downloadResult = await sandbox.exec(
            `yt-dlp --no-check-certificates ` +
                `--extract-audio --audio-format mp3 --audio-quality 0 ` +
                `-o ${escapedPath} --no-playlist ${escapedUrl}`,
        )

        if (!downloadResult.success) {
            throw new Error(
                `Failed to download ${video.title}: ${downloadResult.stderr}`,
            )
        }

        return {path, filename}
    } catch (error) {
        await sandbox.exec(`rm -f ${escapedPath}`)
        throw error
    }
}

// Download a track, hash it, and leave it in the sandbox for direct upload
async function prepareTrack(
    env: Env,
    sandboxId: string,
    track: YouTubeVideo,
): Promise<Track> {
    if (
        track.duration !== undefined &&
        track.duration > MAX_TRACK_DURATION_SECONDS
    ) {
        throw new Error(
            `${track.title} is too long for Yoto. ` +
                `Tracks must be 60 minutes or shorter.`,
        )
    }

    const downloadedAudio = await downloadVideo(env, sandboxId, track)
    const sandbox = getSandbox(env.SANDBOX, sandboxId)
    const escapedPath = escapeShellArg(downloadedAudio.path)

    try {
        const sizeResult = await sandbox.exec(`stat -c %s ${escapedPath}`)
        if (!sizeResult.success) {
            throw new Error(
                `Failed to measure ${track.title}: ${sizeResult.stderr}`,
            )
        }

        const byteLength = Number.parseInt(sizeResult.stdout.trim(), 10)
        if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
            throw new Error(`Failed to measure ${track.title}: invalid size`)
        }

        const durationResult = await sandbox.exec(
            `ffprobe -v error -show_entries format=duration ` +
                `-of default=noprint_wrappers=1:nokey=1 ${escapedPath}`,
        )
        if (!durationResult.success) {
            throw new Error(
                `Failed to measure ${track.title}: ${durationResult.stderr}`,
            )
        }

        const durationSeconds = Number.parseFloat(durationResult.stdout.trim())
        if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
            throw new Error(
                `Failed to measure ${track.title}: invalid duration`,
            )
        }

        const isTooLarge = byteLength > MAX_TRACK_BYTES
        const isTooLong = durationSeconds > MAX_TRACK_DURATION_SECONDS

        if (isTooLarge && isTooLong) {
            throw new Error(
                `${track.title} is too long and too large for Yoto. ` +
                    `Tracks must be 60 minutes or shorter and 100 MB or smaller.`,
            )
        }

        if (isTooLong) {
            throw new Error(
                `${track.title} is too long for Yoto. ` +
                    `Tracks must be 60 minutes or shorter.`,
            )
        }

        if (isTooLarge) {
            throw new Error(
                `${track.title} is too large for Yoto. ` +
                    `Tracks must be 100 MB or smaller.`,
            )
        }

        const hashResult = await sandbox.exec(`sha256sum ${escapedPath}`)
        if (!hashResult.success) {
            throw new Error(
                `Failed to hash ${track.title}: ${hashResult.stderr}`,
            )
        }

        const sha256 = hashResult.stdout.trim().split(/\s+/)[0]
        if (!/^[a-f0-9]{64}$/.test(sha256)) {
            throw new Error(`Failed to hash ${track.title}: invalid SHA-256`)
        }

        return {...downloadedAudio, sha256, byteLength}
    } catch (error) {
        await sandbox.exec(`rm -f ${escapedPath}`)
        throw error
    }
}

// Upload a prepared track without moving its bytes through the Worker
async function uploadTrack(
    env: Env,
    sandboxId: string,
    track: Track,
    uploadUrl: string,
): Promise<void> {
    let parsedUploadUrl: URL
    try {
        parsedUploadUrl = new URL(uploadUrl)
    } catch {
        throw new Error("Invalid Yoto upload URL")
    }

    if (parsedUploadUrl.protocol !== "https:") {
        throw new Error("Invalid Yoto upload URL")
    }

    const sandbox = getSandbox(env.SANDBOX, sandboxId)
    const escapedPath = escapeShellArg(track.path)
    const uploadResult = await sandbox.exec(
        `curl --fail --silent --show-error ` +
            `--header 'Content-Type: audio/mpeg' ` +
            `--upload-file ${escapedPath} "$YOTO_UPLOAD_URL"`,
        {env: {YOTO_UPLOAD_URL: uploadUrl}},
    )

    if (!uploadResult.success) {
        throw new Error(
            `Failed to upload ${track.filename}: ${uploadResult.stderr}`,
        )
    }
}

// Remove a prepared track after it is uploaded or no longer needed
async function removeTrack(
    env: Env,
    sandboxId: string,
    track: Track,
): Promise<void> {
    const sandbox = getSandbox(env.SANDBOX, sandboxId)
    const escapedPath = escapeShellArg(track.path)
    const removeResult = await sandbox.exec(`rm -f ${escapedPath}`)

    if (!removeResult.success) {
        throw new Error(
            `Failed to remove ${track.filename}: ${removeResult.stderr}`,
        )
    }
}

async function destroySandbox(env: Env, sandboxId: string): Promise<void> {
    const sandbox = getSandbox(env.SANDBOX, sandboxId)
    await sandbox.destroy()
}

export {
    destroySandbox,
    downloadVideo,
    getPlaylistInfo,
    prepareTrack,
    removeTrack,
    uploadTrack,
}
export type {DownloadedAudio, Track}
