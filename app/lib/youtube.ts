type YouTubeUrlType = "video" | "playlist" | "unknown"

const getYouTubeUrlType = (value: string): YouTubeUrlType => {
    try {
        const url = new URL(value)
        const isYouTubeHost =
            url.hostname === "youtube.com" ||
            url.hostname.endsWith(".youtube.com") ||
            url.hostname === "youtu.be"

        if (!isYouTubeHost) return "unknown"
        if (url.searchParams.has("list")) return "playlist"

        if (
            (url.hostname === "youtube.com" ||
                url.hostname.endsWith(".youtube.com")) &&
            url.pathname === "/watch" &&
            url.searchParams.has("v")
        ) {
            return "video"
        }

        if (url.hostname === "youtu.be" && url.pathname.slice(1)) {
            return "video"
        }

        return "unknown"
    } catch {
        return "unknown"
    }
}

const getCanonicalYouTubeUrl = (value: string): string => {
    try {
        const url = new URL(value)
        const type = getYouTubeUrlType(value)

        if (type === "playlist") {
            const playlistId = url.searchParams.get("list")
            if (playlistId) {
                return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`
            }
        }

        if (type === "video") {
            const videoId =
                url.hostname === "youtu.be"
                    ? url.pathname.slice(1)
                    : url.searchParams.get("v")
            if (videoId) {
                return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
            }
        }

        return value
    } catch {
        return value
    }
}

export {getCanonicalYouTubeUrl, getYouTubeUrlType}
export type {YouTubeUrlType}
