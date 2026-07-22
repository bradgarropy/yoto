// Sandbox client for calling yt-dlp operations via Durable Object
// Uses the sandbox endpoints defined in workers/app.ts

import {getSandbox} from "@cloudflare/sandbox"
import shellEscape from "shell-escape"

import type {AudioTrack} from "./import"
import {logger} from "./logger.server"
import type {
    YouTubeChapter,
    YouTubePlaylistInfo,
    YouTubeVideo,
} from "./youtube.server"

type DownloadedAudio = {
    path: string
    filename: string
    contentType: string
}

type Track = DownloadedAudio & {
    sha256: string
    byteLength: number
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
    const startedAt = Date.now()

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

        logger.info({
            message: "youtube.inspect.completed",
            sandboxId,
            sourceType: "playlist",
            sourceCount: videos.length,
            durationMs: Date.now() - startedAt,
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

        const infoJsonPath = "/tmp/source.info.json"
        await sandbox.writeFile(infoJsonPath, output)
        const video = {...parseVideoInfo(output), infoJsonPath}

        logger.info({
            message: "youtube.inspect.completed",
            sandboxId,
            sourceType: "video",
            sourceCount: 1,
            durationMs: Date.now() - startedAt,
        })

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
    const startedAt = Date.now()
    const sandbox = getSandbox(env.SANDBOX, sandboxId)
    const filename = `${video.id}.m4a`
    const path = `/tmp/${filename}`
    const contentType = "audio/mp4"
    const escapedPath = escapeShellArg(path)
    const input = video.infoJsonPath
        ? `--load-info-json ${escapeShellArg(video.infoJsonPath)}`
        : `--no-playlist ${escapeShellArg(video.url)}`

    // Remove files left behind by an interrupted attempt for the same video.
    await sandbox.exec(`rm -f ${escapedPath}`)

    try {
        const downloadResult = await sandbox.exec(
            `yt-dlp --no-check-certificates ` +
                `--format 'bestaudio[ext=m4a]' ` +
                `-o ${escapedPath} ${input}`,
        )

        if (!downloadResult.success) {
            throw new Error(
                `Failed to download ${video.title}: ${downloadResult.stderr}`,
            )
        }

        logger.info({
            message: "youtube.audio.download.completed",
            sandboxId,
            videoId: video.id,
            sourceDurationSeconds: video.duration,
            durationMs: Date.now() - startedAt,
        })

        return {path, filename, contentType}
    } catch (error) {
        await sandbox.exec(`rm -f ${escapedPath}`)
        throw error
    }
}

// Split downloaded audio into chapter files without re-encoding
async function splitAudio(
    env: Env,
    sandboxId: string,
    source: DownloadedAudio,
    tracks: AudioTrack[],
): Promise<DownloadedAudio[]> {
    const startedAt = Date.now()
    const segments = tracks.map(track => {
        const {startTime, endTime} = track
        if (
            startTime === undefined ||
            endTime === undefined ||
            !Number.isFinite(startTime) ||
            !Number.isFinite(endTime) ||
            startTime < 0 ||
            endTime <= startTime
        ) {
            throw new Error(`Invalid chapter range for ${track.title}`)
        }

        const audio = {
            path: `/tmp/${track.id}.m4a`,
            filename: `${track.id}.m4a`,
            contentType: source.contentType,
        }
        if (audio.path === source.path) {
            throw new Error(`Invalid chapter output for ${track.title}`)
        }

        return {
            audio,
            duration: endTime - startTime,
            startTime,
            title: track.title,
        }
    })

    const sandbox = getSandbox(env.SANDBOX, sandboxId)
    const escapedSourcePath = escapeShellArg(source.path)

    try {
        for (const segment of segments) {
            const escapedOutputPath = escapeShellArg(segment.audio.path)
            await sandbox.exec(`rm -f ${escapedOutputPath}`)

            const splitResult = await sandbox.exec(
                `ffmpeg -v error -y ` +
                    `-ss ${segment.startTime} -i ${escapedSourcePath} ` +
                    `-t ${segment.duration} -map 0:a:0 -c:a copy ` +
                    `${escapedOutputPath}`,
            )
            if (!splitResult.success) {
                throw new Error(
                    `Failed to split ${segment.title}: ${splitResult.stderr}`,
                )
            }
        }

        logger.info({
            message: "audio.split.completed",
            sandboxId,
            sourceFilename: source.filename,
            trackCount: segments.length,
            durationMs: Date.now() - startedAt,
        })

        return segments.map(segment => segment.audio)
    } catch (error) {
        for (const segment of segments) {
            const escapedOutputPath = escapeShellArg(segment.audio.path)
            await sandbox.exec(`rm -f ${escapedOutputPath}`)
        }
        throw error
    }
}

// Validate and hash downloaded audio for direct upload
async function prepareAudio(
    env: Env,
    sandboxId: string,
    audio: DownloadedAudio,
    title: string,
): Promise<Track> {
    const startedAt = Date.now()
    const sandbox = getSandbox(env.SANDBOX, sandboxId)
    const escapedPath = escapeShellArg(audio.path)

    try {
        const sizeResult = await sandbox.exec(`stat -c %s ${escapedPath}`)
        if (!sizeResult.success) {
            throw new Error(`Failed to measure ${title}: ${sizeResult.stderr}`)
        }

        const byteLength = Number.parseInt(sizeResult.stdout.trim(), 10)
        if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
            throw new Error(`Failed to measure ${title}: invalid size`)
        }

        const durationResult = await sandbox.exec(
            `ffprobe -v error -show_entries format=duration ` +
                `-of default=noprint_wrappers=1:nokey=1 ${escapedPath}`,
        )
        if (!durationResult.success) {
            throw new Error(
                `Failed to measure ${title}: ${durationResult.stderr}`,
            )
        }

        const durationSeconds = Number.parseFloat(durationResult.stdout.trim())
        if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
            throw new Error(`Failed to measure ${title}: invalid duration`)
        }

        const isTooLarge = byteLength > MAX_TRACK_BYTES
        const isTooLong = durationSeconds > MAX_TRACK_DURATION_SECONDS

        if (isTooLarge && isTooLong) {
            throw new Error(
                `${title} is too long and too large for Yoto. ` +
                    `Tracks must be 60 minutes or shorter and 100 MB or smaller.`,
            )
        }

        if (isTooLong) {
            throw new Error(
                `${title} is too long for Yoto. ` +
                    `Tracks must be 60 minutes or shorter.`,
            )
        }

        if (isTooLarge) {
            throw new Error(
                `${title} is too large for Yoto. ` +
                    `Tracks must be 100 MB or smaller.`,
            )
        }

        const hashResult = await sandbox.exec(`sha256sum ${escapedPath}`)
        if (!hashResult.success) {
            throw new Error(`Failed to hash ${title}: ${hashResult.stderr}`)
        }

        const sha256 = hashResult.stdout.trim().split(/\s+/)[0]
        if (!/^[a-f0-9]{64}$/.test(sha256)) {
            throw new Error(`Failed to hash ${title}: invalid SHA-256`)
        }

        logger.info({
            message: "audio.prepare.completed",
            sandboxId,
            filename: audio.filename,
            bytes: byteLength,
            durationSeconds,
            durationMs: Date.now() - startedAt,
        })

        return {...audio, sha256, byteLength}
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

    const audio = await downloadVideo(env, sandboxId, track)
    return prepareAudio(env, sandboxId, audio, track.title)
}

// Prepare every requested track from one source video
async function prepareTracks(
    env: Env,
    sandboxId: string,
    video: YouTubeVideo,
    tracks: AudioTrack[],
): Promise<Track[]> {
    if (tracks.length === 0) return []

    if (tracks.some(track => track.sourceId !== video.id)) {
        throw new Error(`Tracks do not belong to ${video.title}`)
    }

    const segmentedTracks = tracks.filter(
        track => track.startTime !== undefined || track.endTime !== undefined,
    )

    if (segmentedTracks.length === 0) {
        if (tracks.length !== 1) {
            throw new Error(
                `Multiple whole tracks requested for ${video.title}`,
            )
        }
        return [await prepareTrack(env, sandboxId, video)]
    }

    if (segmentedTracks.length !== tracks.length) {
        throw new Error(`Mixed track ranges requested for ${video.title}`)
    }

    let source: DownloadedAudio | undefined
    let chapterAudio: DownloadedAudio[] = []

    try {
        source = await downloadVideo(env, sandboxId, video)
        chapterAudio = await splitAudio(env, sandboxId, source, tracks)

        const preparedTracks: Track[] = []
        for (const [index, audio] of chapterAudio.entries()) {
            preparedTracks.push(
                await prepareAudio(env, sandboxId, audio, tracks[index].title),
            )
        }

        await removeTrack(env, sandboxId, source)
        return preparedTracks
    } catch (error) {
        await Promise.allSettled(
            chapterAudio.map(audio => removeTrack(env, sandboxId, audio)),
        )
        if (source) {
            await Promise.allSettled([removeTrack(env, sandboxId, source)])
        }
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
            `--header ${escapeShellArg(`Content-Type: ${track.contentType}`)} ` +
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
    track: DownloadedAudio,
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
    prepareAudio,
    prepareTrack,
    prepareTracks,
    removeTrack,
    splitAudio,
    uploadTrack,
}
export type {DownloadedAudio, Track}
