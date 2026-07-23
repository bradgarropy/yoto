// Import progress tracking type (shared between client and server)
export type ImportTrackProgress = {
    duration?: number
    prepared: boolean
    uploaded: boolean
    ready: boolean
}

export type ImportProgressSummary = {
    percent: number
    total: number
    prepared: number
    uploaded: number
    ready: number
}

export type ImportProgress =
    | ({phase: "preparing"} & ImportProgressSummary)
    | ({phase: "importing"} & ImportProgressSummary)
    | ({phase: "finalizing"} & ImportProgressSummary)

const IMPORT_PROGRESS_WEIGHT = {
    INSPECTION: 5,
    PREPARATION: 30,
    UPLOAD: 25,
    TRANSCODE: 35,
    CARD_UPDATE: 5,
} as const

function getTrackWeights(tracks: ImportTrackProgress[]): number[] {
    if (tracks.length === 0) return []

    const knownDurations = tracks.flatMap(track =>
        track.duration !== undefined &&
        Number.isFinite(track.duration) &&
        track.duration > 0
            ? [track.duration]
            : [],
    )
    const fallbackDuration =
        knownDurations.length > 0
            ? knownDurations.reduce((total, duration) => total + duration, 0) /
              knownDurations.length
            : 1
    const durations = tracks.map(track =>
        track.duration !== undefined &&
        Number.isFinite(track.duration) &&
        track.duration > 0
            ? track.duration
            : fallbackDuration,
    )
    const totalDuration = durations.reduce(
        (total, duration) => total + duration,
        0,
    )

    return durations.map(duration => duration / totalDuration)
}

export function getImportProgressSummary({
    inspected,
    tracks,
    cardUpdated,
}: {
    inspected: boolean
    tracks: ImportTrackProgress[]
    cardUpdated: boolean
}): ImportProgressSummary {
    const weights = getTrackWeights(tracks)
    let percent = inspected ? IMPORT_PROGRESS_WEIGHT.INSPECTION : 0

    tracks.forEach((track, index) => {
        const weight = weights[index]
        if (track.prepared) {
            percent += IMPORT_PROGRESS_WEIGHT.PREPARATION * weight
        }
        if (track.uploaded) {
            percent += IMPORT_PROGRESS_WEIGHT.UPLOAD * weight
        }
        if (track.ready) {
            percent += IMPORT_PROGRESS_WEIGHT.TRANSCODE * weight
        }
    })

    if (cardUpdated) {
        percent += IMPORT_PROGRESS_WEIGHT.CARD_UPDATE
    }

    return {
        percent: Math.min(Math.round(percent), 100),
        total: tracks.length,
        prepared: tracks.filter(track => track.prepared).length,
        uploaded: tracks.filter(track => track.uploaded).length,
        ready: tracks.filter(track => track.ready).length,
    }
}

export function getProgressPercent(progress: ImportProgress | null): number {
    return progress?.percent ?? 0
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
 * Compute the next chapter key based on existing chapters.
 * Uses the max numeric key + 1 to avoid collisions when chapters
 * have been deleted (which leaves gaps in the key sequence).
 */
export const getNextChapterKey = (chapters: Array<{key?: string}>): string => {
    const maxKey = chapters.reduce((max, ch) => {
        const num = parseInt(ch.key ?? "0", 10)
        return num > max ? num : max
    }, -1)
    return String(maxKey + 1).padStart(2, "0")
}

/**
 * Create a chapter object from an uploaded audio file.
 *
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
