// Import progress tracking type (shared between client and server)
export type ImportProgress = {
    phase:
        | "preparing"
        | "downloading"
        | "uploading"
        | "transcoding"
        | "finalizing"
    current?: number
    total?: number
    title?: string
}

/**
 * Calculate the progress percentage for an import operation.
 *
 * Progress is phase-based, where each phase completes for all tracks
 * before moving to the next phase:
 * - preparing: 0%
 * - downloading: 5-35% (current track in progress, 1-indexed)
 * - uploading: 35-65% (current track in progress, 1-indexed)
 * - transcoding: 65-95% (current track in progress, 1-indexed)
 * - finalizing: 95%
 *
 * The `current` value represents which track is currently being worked on (1-indexed).
 * For example, current=2, total=3 means "working on track 2 of 3".
 *
 * Note: 100% is not returned by this function; completion is handled
 * separately when the import finishes successfully.
 */
export function getProgressPercent(progress: ImportProgress | null): number {
    if (!progress) return 0

    // Preparing phase stays at 0%
    if (progress.phase === "preparing") {
        return 0
    }

    // Finalizing phase shows 95%
    if (progress.phase === "finalizing") {
        return 95
    }

    // Handle track phases without counts - return start of phase
    if (progress.total === undefined || progress.total === 0) {
        if (progress.phase === "downloading") return 5
        if (progress.phase === "uploading") return 35
        if (progress.phase === "transcoding") return 65
        return 5
    }

    // Each phase gets 30% of the progress bar (5-35, 35-65, 65-95)
    // current is 1-indexed (track currently in progress)
    // Progress within phase = (current - 1) / total
    // e.g., current=1/total=3 → 0/3 = 0% into phase (start of phase)
    // e.g., current=2/total=3 → 1/3 = 33% into phase
    // e.g., current=3/total=3 → 2/3 = 67% into phase
    const phaseSize = 30
    const progressInPhase = ((progress.current ?? 1) - 1) / progress.total

    let phaseStart = 5
    if (progress.phase === "uploading") {
        phaseStart = 35
    } else if (progress.phase === "transcoding") {
        phaseStart = 65
    }

    const percent = phaseStart + progressInPhase * phaseSize

    return Math.min(Math.round(percent), 95)
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
