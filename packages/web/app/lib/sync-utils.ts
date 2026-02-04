// Yoto types for card content
export type YotoTrack = {
    key: string
    title: string
    format: string
    trackUrl: string
    type: string
    duration?: number
    fileSize?: number
    channels?: string
}

export type YotoChapter = {
    key: string
    title: string
    tracks: YotoTrack[]
    duration?: number
    fileSize?: number
}

/**
 * Recursively strip null values from an object.
 * The Yoto API rejects null values - fields should either be omitted or have valid values.
 */
export const stripNullValues = <T>(obj: T): T => {
    if (obj === null || obj === undefined) {
        return obj
    }
    if (Array.isArray(obj)) {
        return obj.map(stripNullValues) as T
    }
    if (typeof obj === "object") {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null) {
                result[key] = stripNullValues(value)
            }
        }
        return result as T
    }
    return obj
}

/**
 * Create a chapter object from an uploaded audio file.
 * @param title - The chapter/track title
 * @param transcodedSha256 - The SHA256 hash of the transcoded audio file
 * @param position - The 1-based position of the chapter in the playlist
 * @param duration - Optional duration in seconds
 * @param fileSize - Optional file size in bytes
 */
export const createChapter = (
    title: string,
    transcodedSha256: string,
    position: number,
    duration?: number,
    fileSize?: number,
): YotoChapter => {
    const chapterKey = String(position - 1).padStart(2, "0")

    return {
        key: chapterKey,
        title,
        tracks: [
            {
                key: "01",
                title,
                format: "opus",
                trackUrl: `yoto:#${transcodedSha256}`,
                type: "audio",
                duration,
                fileSize,
                channels: "stereo",
            },
        ],
        duration,
        fileSize,
    }
}
