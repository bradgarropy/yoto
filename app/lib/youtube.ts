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

export {getYouTubeUrlType}
export type {YouTubeUrlType}
