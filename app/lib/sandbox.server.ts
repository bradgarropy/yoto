// Sandbox client for calling yt-dlp operations via Durable Object
// Uses the sandbox endpoints defined in workers/app.ts

import {collectFile, getSandbox} from "@cloudflare/sandbox"
import shellEscape from "shell-escape"

import type {
    YouTubePlaylistInfo,
    YouTubeTrack as SourceTrack,
} from "./youtube.server"

type Track = {
    path: string
    filename: string
    sha256: string
    byteLength: number
}

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

// Get playlist/video info from YouTube via sandbox
async function getPlaylistInfo(
    env: Env,
    url: string,
): Promise<YouTubePlaylistInfo> {
    // Validate URL before processing
    if (!isYoutubeUrl(url)) {
        throw new Error("Invalid YouTube URL")
    }

    const sandbox = getSandbox(env.SANDBOX, "sync-worker")
    const escapedUrl = escapeShellArg(url)

    // Detect if URL is a playlist
    const isPlaylist = url.includes("list=")

    if (isPlaylist) {
        const result = await sandbox.exec(
            `yt-dlp --no-check-certificates --flat-playlist --print "%(playlist_id)s\t%(playlist_title)s\t%(id)s\t%(title)s" ${escapedUrl}`,
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

        const videos: SourceTrack[] = lines.map(line => {
            const [, , videoId, title] = line.split("\t")
            return {
                id: videoId,
                title,
                url: `https://www.youtube.com/watch?v=${videoId}`,
            }
        })

        return {id: playlistId, title: playlistTitle, videos}
    } else {
        const result = await sandbox.exec(
            `yt-dlp --no-check-certificates --print "%(id)s\t%(title)s" --no-playlist ${escapedUrl}`,
        )

        if (!result.success) {
            throw new Error(`Failed to get video info: ${result.stderr}`)
        }

        const line = result.stdout.trim()
        if (!line) {
            throw new Error("No video info found")
        }

        const [videoId, title] = line.split("\t")

        return {
            id: videoId,
            title,
            videos: [
                {
                    id: videoId,
                    title,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                },
            ],
        }
    }
}

// Download a track, hash it, and leave it in the sandbox for direct upload
async function prepareTrack(env: Env, track: SourceTrack): Promise<Track> {
    const sandbox = getSandbox(env.SANDBOX, "sync-worker")
    const filename = `${track.id}.mp3`
    const path = `/tmp/${filename}`
    const escapedPath = escapeShellArg(path)
    const escapedUrl = escapeShellArg(track.url)

    // Remove files left behind by an interrupted attempt for the same track.
    await sandbox.exec(`rm -f ${escapedPath}`)

    try {
        const downloadResult = await sandbox.exec(
            `yt-dlp --no-check-certificates ` +
                `--extract-audio --audio-format mp3 --audio-quality 0 ` +
                `-o ${escapedPath} --no-playlist ${escapedUrl}`,
        )

        if (!downloadResult.success) {
            throw new Error(
                `Failed to download ${track.title}: ${downloadResult.stderr}`,
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

        return {path, filename, sha256, byteLength}
    } catch (error) {
        await sandbox.exec(`rm -f ${escapedPath}`)
        throw error
    }
}

// Upload a prepared track without moving its bytes through the Worker
async function uploadTrack(
    env: Env,
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

    const sandbox = getSandbox(env.SANDBOX, "sync-worker")
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
async function removeTrack(env: Env, track: Track): Promise<void> {
    const sandbox = getSandbox(env.SANDBOX, "sync-worker")
    const escapedPath = escapeShellArg(track.path)
    const removeResult = await sandbox.exec(`rm -f ${escapedPath}`)

    if (!removeResult.success) {
        throw new Error(
            `Failed to remove ${track.filename}: ${removeResult.stderr}`,
        )
    }
}

// Download a track and return as ArrayBuffer
async function downloadTrack(
    env: Env,
    track: SourceTrack,
): Promise<ArrayBuffer> {
    const sandbox = getSandbox(env.SANDBOX, "sync-worker")
    const outputPath = `/tmp/${track.id}.mp3`
    const escapedOutputPath = escapeShellArg(outputPath)
    const escapedUrl = escapeShellArg(track.url)

    // Download and convert to MP3
    // Note: --no-check-certificates handles SSL issues in container environments
    const downloadResult = await sandbox.exec(
        `yt-dlp --no-check-certificates ` +
            `--extract-audio --audio-format mp3 --audio-quality 0 ` +
            `-o ${escapedOutputPath} --no-playlist ${escapedUrl}`,
    )

    if (!downloadResult.success) {
        throw new Error(
            `Failed to download ${track.title}: ${downloadResult.stderr}`,
        )
    }

    // Stream file from sandbox to avoid 32MiB RPC serialization limit
    try {
        const stream = await sandbox.readFileStream(outputPath)
        const {content} = await collectFile(stream)

        if (content instanceof Uint8Array) {
            return content.buffer as ArrayBuffer
        }

        // Fallback: content is a string (text encoding), convert to ArrayBuffer
        const encoder = new TextEncoder()
        return encoder.encode(content).buffer as ArrayBuffer
    } finally {
        await sandbox.exec(`rm -f ${escapedOutputPath}`)
    }
}

export {downloadTrack, getPlaylistInfo, prepareTrack, removeTrack, uploadTrack}
export type {Track}
