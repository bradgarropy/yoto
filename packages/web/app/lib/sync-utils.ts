// Import progress tracking type (shared between client and server)
export type ImportProgress = {
    phase: "fetching" | "downloading" | "uploading" | "transcoding" | "updating"
    current?: number
    total?: number
    title?: string
}

/**
 * Calculate the progress percentage for an import operation.
 * Handles phases that don't have current/total counts (like "fetching" and "updating").
 */
export function getProgressPercent(progress: ImportProgress | null): number {
    if (!progress) return 0

    // Handle phases that don't have current/total counts
    if (!progress.current || !progress.total) {
        // "updating" is the final phase after all tracks are processed
        if (progress.phase === "updating") {
            return 100
        }
        return 0
    }

    const trackProgress = (progress.current - 1) / progress.total
    const phaseBonus = progress.phase === "uploading" ? 0.5 / progress.total : 0

    return Math.min(Math.round((trackProgress + phaseBonus) * 100), 100)
}

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
