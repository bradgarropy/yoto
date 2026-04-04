// Sandbox client for calling yt-dlp operations via Durable Object
// Uses the sandbox endpoints defined in workers/app.ts

import {collectFile, getSandbox} from "@cloudflare/sandbox"
import shellEscape from "shell-escape"

import type {YouTubePlaylistInfo, YouTubeTrack} from "./youtube.server"

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

        const tracks: YouTubeTrack[] = lines.map(line => {
            const [, , videoId, title] = line.split("\t")
            return {
                id: videoId,
                title,
                url: `https://www.youtube.com/watch?v=${videoId}`,
            }
        })

        return {id: playlistId, title: playlistTitle, tracks}
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
            tracks: [
                {
                    id: videoId,
                    title,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                },
            ],
        }
    }
}

// Download a track and return as ArrayBuffer
async function downloadTrack(
    env: Env,
    track: YouTubeTrack,
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

export {downloadTrack, getPlaylistInfo}
