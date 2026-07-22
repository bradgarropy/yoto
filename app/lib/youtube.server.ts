// YouTube URL parsing utilities and types
// Note: Actual yt-dlp operations moved to sandbox (workers/app.ts)

// Types
type YouTubeChapter = {
    title: string
    startTime: number
    endTime: number
}

type YouTubeVideo = {
    id: string
    title: string
    url: string
    duration?: number
    chapters?: YouTubeChapter[]
    infoJsonPath?: string
}

type YouTubePlaylist = {
    id: string
    title: string
    videos: YouTubeVideo[]
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

export {extractPlaylistId, extractVideoId, isPlaylistUrl}
export type {
    YouTubeChapter,
    YouTubePlaylist as YouTubePlaylistInfo,
    YouTubeVideo,
}
