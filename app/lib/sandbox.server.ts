// Sandbox client for calling yt-dlp operations via Durable Object
// Uses the sandbox endpoints defined in workers/app.ts

import {getSandbox} from "@cloudflare/sandbox"

import type {YouTubePlaylistInfo, YouTubeTrack} from "./youtube.server"

// Get playlist/video info from YouTube via sandbox
async function getPlaylistInfo(
    env: Env,
    url: string,
): Promise<YouTubePlaylistInfo> {
    const sandbox = getSandbox(env.SANDBOX, "sync-worker")

    // Detect if URL is a playlist
    const isPlaylist = url.includes("list=")

    if (isPlaylist) {
        const result = await sandbox.exec(
            `yt-dlp --no-check-certificates --flat-playlist --print "%(playlist_id)s\t%(playlist_title)s\t%(id)s\t%(title)s" "${url}"`,
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
            `yt-dlp --no-check-certificates --print "%(id)s\t%(title)s" --no-playlist "${url}"`,
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

    // Download and convert to MP3
    // Note: --js-runtimes node:/usr/local/bin/node specifies Node path for EJS challenge solving
    // Note: --no-check-certificates handles SSL issues in container environments
    const downloadResult = await sandbox.exec(
        `yt-dlp --no-check-certificates --js-runtimes node:/usr/local/bin/node ` +
            `--extract-audio --audio-format mp3 --audio-quality 0 ` +
            `-o "${outputPath}" --no-playlist "${track.url}"`,
    )

    if (!downloadResult.success) {
        throw new Error(
            `Failed to download ${track.title}: ${downloadResult.stderr}`,
        )
    }

    // Read file as base64
    const readResult = await sandbox.exec(`base64 -w 0 "${outputPath}"`)

    if (!readResult.success) {
        throw new Error(`Failed to read downloaded file: ${readResult.stderr}`)
    }

    // Clean up
    await sandbox.exec(`rm -f "${outputPath}"`)

    // Convert base64 to ArrayBuffer
    const base64 = readResult.stdout.trim()
    const binaryString = atob(base64)
    const bytes = Uint8Array.from(binaryString, c => c.charCodeAt(0))

    return bytes.buffer
}

export {downloadTrack, getPlaylistInfo}
