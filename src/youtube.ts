import {spawn} from "node:child_process"
import {join} from "node:path"

// Types
type YouTubeTrack = {
    id: string
    title: string
    url: string
}

type YouTubePlaylistInfo = {
    id: string
    title: string
    tracks: YouTubeTrack[]
}

// Extract playlist ID from URL
const extractPlaylistId = (url: string): string => {
    const urlObj = new URL(url)
    const listParam = urlObj.searchParams.get("list")

    if (listParam) {
        return listParam
    }

    // Handle youtu.be/playlist?list= format
    if (url.includes("playlist?list=")) {
        const match = url.match(/list=([^&]+)/)
        if (match) {
            return match[1]
        }
    }

    throw new Error("Could not extract playlist ID from URL")
}

// YouTube playlist info extraction using yt-dlp
const getPlaylistInfo = async (url: string): Promise<YouTubePlaylistInfo> => {
    return new Promise((resolve, reject) => {
        const args = [
            "--flat-playlist",
            "--print",
            "%(playlist_id)s\t%(playlist_title)s\t%(id)s\t%(title)s",
            url,
        ]

        const ytDlp = spawn("yt-dlp", args)

        let output = ""
        let stderr = ""

        ytDlp.stdout.on("data", data => {
            output += data.toString()
        })

        ytDlp.stderr.on("data", data => {
            stderr += data.toString()
        })

        ytDlp.on("error", error => {
            reject(new Error(`Failed to get playlist info: ${error.message}`))
        })

        ytDlp.on("close", code => {
            if (code !== 0) {
                reject(new Error(`yt-dlp failed (exit code ${code}): ${stderr}`))
                return
            }

            const lines = output.trim().split("\n").filter(Boolean)

            if (lines.length === 0) {
                reject(new Error("No tracks found in playlist"))
                return
            }

            // Parse first line to get playlist info
            const [playlistId, playlistTitle] = lines[0].split("\t")

            const tracks: YouTubeTrack[] = lines.map(line => {
                const [, , videoId, title] = line.split("\t")
                return {
                    id: videoId,
                    title: title,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                }
            })

            resolve({
                id: playlistId,
                title: playlistTitle,
                tracks,
            })
        })
    })
}

// Download a single track
const downloadTrack = async (
    track: YouTubeTrack,
    outputDir: string,
): Promise<string> => {
    return new Promise((resolve, reject) => {
        const outputPath = join(outputDir, `${track.id}.mp3`)

        const args = [
            "--extract-audio",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "-o",
            outputPath,
            "--no-playlist",
            // Use TV client to avoid SABR/403 issues
            "--extractor-args",
            "youtube:player_client=tv",
            // Use Chrome cookies for authentication
            "--cookies-from-browser",
            "chrome",
            track.url,
        ]

        const ytDlp = spawn("yt-dlp", args)

        let stderr = ""

        ytDlp.stderr.on("data", data => {
            stderr += data.toString()
        })

        ytDlp.on("error", error => {
            reject(
                new Error(`Failed to download ${track.title}: ${error.message}`),
            )
        })

        ytDlp.on("close", code => {
            if (code === 0) {
                resolve(outputPath)
            } else {
                const errorMsg = stderr.trim() || `exit code ${code}`
                reject(new Error(`Failed to download ${track.title}: ${errorMsg}`))
            }
        })
    })
}

export {downloadTrack, extractPlaylistId, getPlaylistInfo}
export type {YouTubePlaylistInfo, YouTubeTrack}
