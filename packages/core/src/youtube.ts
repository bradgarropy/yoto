import {spawn} from "node:child_process"
import {join} from "node:path"

// Check if error indicates yt-dlp needs updating
const needsYtDlpUpdate = (stderr: string): boolean => {
    return (
        stderr.includes("n challenge solving failed") ||
        stderr.includes("Ensure you have a supported JavaScript runtime") ||
        stderr.includes("Some formats may be missing")
    )
}

// Create user-friendly error message
const createErrorMessage = (stderr: string, defaultMsg: string): string => {
    if (needsYtDlpUpdate(stderr)) {
        return "YouTube download failed due to outdated yt-dlp. Please update by running: brew upgrade yt-dlp"
    }
    return defaultMsg
}

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

// Check if URL is a playlist
const isPlaylistUrl = (url: string): boolean => {
    const urlObj = new URL(url)
    const listParam = urlObj.searchParams.get("list")
    return !!listParam || url.includes("playlist?list=")
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

// Extract video ID from URL
const extractVideoId = (url: string): string => {
    const urlObj = new URL(url)

    // youtube.com/watch?v=ID format
    const vParam = urlObj.searchParams.get("v")
    if (vParam) {
        return vParam
    }

    // youtu.be/ID format
    if (urlObj.hostname === "youtu.be") {
        return urlObj.pathname.slice(1)
    }

    throw new Error("Could not extract video ID from URL")
}

// Get single video info using yt-dlp
const getVideoInfo = async (url: string): Promise<YouTubePlaylistInfo> => {
    return new Promise((resolve, reject) => {
        const args = ["--print", "%(id)s\t%(title)s", "--no-playlist", url]

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
            reject(new Error(`Failed to get video info: ${error.message}`))
        })

        ytDlp.on("close", code => {
            if (code !== 0) {
                const errorMsg = createErrorMessage(
                    stderr,
                    `yt-dlp failed (exit code ${code}): ${stderr}`,
                )
                reject(new Error(errorMsg))
                return
            }

            const line = output.trim()
            if (!line) {
                reject(new Error("No video info found"))
                return
            }

            const [videoId, title] = line.split("\t")

            resolve({
                id: videoId, // Use video ID as the "playlist" ID for single videos
                title: title,
                tracks: [
                    {
                        id: videoId,
                        title: title,
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                    },
                ],
            })
        })
    })
}

// YouTube playlist info extraction using yt-dlp
const getPlaylistInfo = async (url: string): Promise<YouTubePlaylistInfo> => {
    // If it's not a playlist URL, get single video info
    if (!isPlaylistUrl(url)) {
        return getVideoInfo(url)
    }

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
                const errorMsg = createErrorMessage(
                    stderr,
                    `yt-dlp failed (exit code ${code}): ${stderr}`,
                )
                reject(new Error(errorMsg))
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
                new Error(
                    `Failed to download ${track.title}: ${error.message}`,
                ),
            )
        })

        ytDlp.on("close", code => {
            if (code === 0) {
                resolve(outputPath)
            } else {
                const errorMsg = createErrorMessage(
                    stderr,
                    `Failed to download ${track.title}: ${stderr.trim() || `exit code ${code}`}`,
                )
                reject(new Error(errorMsg))
            }
        })
    })
}

export {
    downloadTrack,
    extractPlaylistId,
    extractVideoId,
    getPlaylistInfo,
    getVideoInfo,
    isPlaylistUrl,
}
export type {YouTubePlaylistInfo, YouTubeTrack}
