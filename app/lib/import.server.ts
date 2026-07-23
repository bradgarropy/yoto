import type {YotoSdk} from "@yotoplay/yoto-sdk"
import pLimit from "p-limit"

import {
    type AudioTrack,
    getImportSandboxId,
    type Import,
    type ImportSuccess,
} from "~/lib/import"
import {
    createChapter,
    getImportProgressSummary,
    getNextChapterKey,
    type ImportProgress,
    type ImportTrackProgress,
    stripNullValues,
    type YotoChapter,
} from "~/lib/import-utils"
import {logger} from "~/lib/logger.server"
import {
    getPlaylistInfo,
    prepareTracks,
    removeTrack,
    type Track,
    uploadTrack,
} from "~/lib/sandbox.server"
import type {YouTubeVideo} from "~/lib/youtube.server"

type YotoContent = {
    activity: string
    chapters: YotoChapter[]
    restricted: boolean
    config: {onlineOnly: boolean}
    version: string
}

type YotoMetadata = {
    cover?: {imageL: string}
    media?: Record<string, unknown>
}

type YotoCard = {
    cardId?: string
    title?: string
    content: YotoContent
    metadata: YotoMetadata
}

type TranscodeResult = {
    progress?: {phase: string}
    transcodedSha256?: string
    transcodedInfo?: {duration: number; fileSize: number}
}

type AudioUploadResult =
    | {alreadyTranscoded: true; key: string; duration: number; fileSize: number}
    | {alreadyTranscoded: false; sha256: string}

type ImportedTrack = {
    index: number
    track: AudioTrack
    audio: AudioUploadResult
}

type TranscodedTrack = {
    index: number
    track: AudioTrack
    audio: {key: string; duration: number; fileSize: number}
}

type AudioLogContext = {
    importId: string
    cardId: string
    trackId: string
    trackTitle: string
}

type PendingTranscode = {
    position: number
    importedTrack: ImportedTrack & {
        audio: Extract<AudioUploadResult, {alreadyTranscoded: false}>
    }
    startedAt: number
}

const CONCURRENCY_LIMIT = 5
const TRANSCODE_MAX_ATTEMPTS = 60
const TRANSCODE_POLL_INTERVAL = 5000

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function createProgressReporter(
    tracks: ImportTrackProgress[],
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
) {
    let reportQueue = Promise.resolve()

    return (
        cardUpdated = false,
        phase: Extract<
            ImportProgress["phase"],
            "importing" | "finalizing"
        > = "importing",
    ) => {
        const progress: ImportProgress = {
            phase,
            ...getImportProgressSummary({
                inspected: true,
                tracks,
                cardUpdated,
            }),
        }
        reportQueue = reportQueue.then(() => onProgress?.(progress))
        return reportQueue
    }
}

function createAudioTracks(
    videos: YouTubeVideo[],
    splitByChapters: boolean,
): AudioTrack[] {
    return videos.flatMap(video => {
        if (!splitByChapters || !video.chapters?.length) {
            return [
                {
                    id: video.id,
                    sourceId: video.id,
                    title: video.title,
                    url: video.url,
                    duration: video.duration,
                },
            ]
        }

        return video.chapters.map((chapter, index) => ({
            id: `${video.id}-${String(index + 1).padStart(2, "0")}`,
            sourceId: video.id,
            title: chapter.title,
            url: video.url,
            duration: chapter.endTime - chapter.startTime,
            startTime: chapter.startTime,
            endTime: chapter.endTime,
        }))
    })
}

// Upload prepared audio from the Sandbox, returns sha256 for transcode polling
async function uploadAudio(
    sdk: YotoSdk,
    env: Env,
    sandboxId: string,
    track: Track,
    context: AudioLogContext,
): Promise<AudioUploadResult> {
    const {sha256} = track
    const cacheLookupStartedAt = Date.now()

    // Check if already transcoded
    try {
        const existingStatus = (await sdk.media.getTranscodedUpload(
            sha256,
            false,
        )) as unknown as TranscodeResult

        logger.debug({
            message: "yoto.audio.transcode.cache_lookup",
            ...context,
            sha256,
            phase: existingStatus?.progress?.phase,
            durationMs: Date.now() - cacheLookupStartedAt,
        })

        if (
            existingStatus?.progress?.phase === "complete" &&
            existingStatus.transcodedSha256
        ) {
            logger.info({
                message: "yoto.audio.transcode.cache_hit",
                ...context,
                sha256,
                transcodedSha256: existingStatus.transcodedSha256,
                durationMs: Date.now() - cacheLookupStartedAt,
            })
            return {
                alreadyTranscoded: true,
                key: existingStatus.transcodedSha256,
                duration: existingStatus.transcodedInfo?.duration ?? 0,
                fileSize: existingStatus.transcodedInfo?.fileSize ?? 0,
            }
        }
    } catch (error) {
        // File doesn't exist yet, continue with upload
        logger.debug({
            message: "yoto.audio.transcode.cache_miss",
            ...context,
            sha256,
            error: getErrorMessage(error),
            durationMs: Date.now() - cacheLookupStartedAt,
        })
    }

    // Get upload URL
    const uploadUrlStartedAt = Date.now()
    const uploadInfo = (await sdk.media.getUploadUrlForTranscode(
        sha256,
        track.filename,
    )) as unknown as {uploadId: string; uploadUrl: string | null}
    const uploadUrlDurationMs = Date.now() - uploadUrlStartedAt

    logger.debug({
        message: "yoto.audio.upload_url.completed",
        ...context,
        sha256,
        uploadId: uploadInfo.uploadId,
        hasUploadUrl: Boolean(uploadInfo.uploadUrl),
        durationMs: uploadUrlDurationMs,
    })

    if (uploadInfo.uploadUrl) {
        const uploadStartedAt = Date.now()

        logger.info({
            message: "yoto.audio.upload.started",
            ...context,
            sha256,
            uploadId: uploadInfo.uploadId,
            bytes: track.byteLength,
        })

        await uploadTrack(env, sandboxId, track, uploadInfo.uploadUrl)

        logger.info({
            message: "yoto.audio.upload.completed",
            ...context,
            sha256,
            uploadId: uploadInfo.uploadId,
            durationMs: Date.now() - uploadStartedAt,
        })
    } else {
        logger.debug({
            message: "yoto.audio.upload.skipped",
            ...context,
            sha256,
            uploadId: uploadInfo.uploadId,
        })
    }

    return {alreadyTranscoded: false, sha256}
}

// Check a transcode once so polling can be scheduled fairly across all tracks
async function pollTranscode(
    sdk: YotoSdk,
    sha256: string,
    context: AudioLogContext,
    attempt: number,
    startedAt: number,
): Promise<{key: string; duration: number; fileSize: number} | null> {
    try {
        const transcodeStatus = (await sdk.media.getTranscodedUpload(
            sha256,
            false,
        )) as unknown as TranscodeResult

        logger.debug({
            message: "yoto.audio.transcode.polled",
            ...context,
            sha256,
            attempt,
            maxAttempts: TRANSCODE_MAX_ATTEMPTS,
            phase: transcodeStatus?.progress?.phase,
        })

        if (
            transcodeStatus?.progress?.phase !== "complete" ||
            !transcodeStatus.transcodedSha256
        ) {
            return null
        }

        logger.info({
            message: "yoto.audio.transcode.completed",
            ...context,
            sha256,
            transcodedSha256: transcodeStatus.transcodedSha256,
            duration: transcodeStatus.transcodedInfo?.duration,
            fileSize: transcodeStatus.transcodedInfo?.fileSize,
            durationMs: Date.now() - startedAt,
        })
        return {
            key: transcodeStatus.transcodedSha256,
            duration: transcodeStatus.transcodedInfo?.duration ?? 0,
            fileSize: transcodeStatus.transcodedInfo?.fileSize ?? 0,
        }
    } catch (error) {
        logger.warn({
            message: "yoto.audio.transcode.poll_failed",
            ...context,
            sha256,
            attempt,
            maxAttempts: TRANSCODE_MAX_ATTEMPTS,
            error: getErrorMessage(error),
        })
        return null
    }
}

async function inspectVideo(
    env: Env,
    cardImport: Import,
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
): Promise<YouTubeVideo[]> {
    const startedAt = Date.now()
    await onProgress?.({
        phase: "preparing",
        percent: 0,
        total: 0,
        prepared: 0,
        uploaded: 0,
        ready: 0,
    })
    const youtubeInfo = await getPlaylistInfo(
        env,
        getImportSandboxId(cardImport),
        cardImport.youtubeUrl,
    )

    logger.info({
        message: "import.inspect.completed",
        importId: cardImport.id,
        cardId: cardImport.cardId,
        sourceCount: youtubeInfo.videos.length,
        durationMs: Date.now() - startedAt,
    })

    return youtubeInfo.videos
}

async function importVideo(
    sdk: YotoSdk,
    env: Env,
    cardImport: Import,
    videos: YouTubeVideo[],
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
): Promise<ImportedTrack[]> {
    const startedAt = Date.now()
    const {cardId} = cardImport
    const sandboxId = getImportSandboxId(cardImport)
    const limit = pLimit(CONCURRENCY_LIMIT)
    let nextTrackIndex = 0
    const sourcePlans = videos.map(video => ({
        video,
        tracks: createAudioTracks([video], cardImport.splitByChapters).map(
            track => ({
                index: nextTrackIndex++,
                track,
            }),
        ),
    }))
    const trackProgress = sourcePlans
        .flatMap(({tracks}) => tracks)
        .sort((first, second) => first.index - second.index)
        .map(({track}) => ({
            duration: track.duration,
            prepared: false,
            uploaded: false,
            ready: false,
        }))
    const reportProgress = createProgressReporter(trackProgress, onProgress)

    const prepareStartedAt = Date.now()
    await reportProgress()

    const downloadResults = await Promise.allSettled(
        sourcePlans.map(({video, tracks}) =>
            limit(async () => {
                const preparedTracks = await prepareTracks(
                    env,
                    sandboxId,
                    video,
                    tracks.map(({track}) => track),
                )
                if (preparedTracks.length !== tracks.length) {
                    await Promise.allSettled(
                        preparedTracks.map(track =>
                            removeTrack(env, sandboxId, track),
                        ),
                    )
                    throw new Error(
                        `Failed to prepare every track for ${video.title}`,
                    )
                }

                tracks.forEach(({index}) => {
                    trackProgress[index].prepared = true
                })
                await reportProgress()
                return preparedTracks.map((preparedTrack, index) => ({
                    ...tracks[index],
                    preparedTrack,
                }))
            }),
        ),
    )

    const failedDownload = downloadResults.find(
        (result): result is PromiseRejectedResult =>
            result.status === "rejected",
    )

    if (failedDownload) {
        await Promise.allSettled(
            downloadResults.flatMap(result =>
                result.status === "fulfilled"
                    ? result.value.map(({preparedTrack}) =>
                          removeTrack(env, sandboxId, preparedTrack),
                      )
                    : [],
            ),
        )
        throw failedDownload.reason
    }

    const downloadedTracks = downloadResults.flatMap(result => {
        if (result.status !== "fulfilled") throw result.reason
        return result.value
    })

    logger.info({
        message: "import.audio.prepare.completed",
        importId: cardImport.id,
        cardId,
        sandboxId,
        sourceCount: videos.length,
        trackCount: downloadedTracks.length,
        durationMs: Date.now() - prepareStartedAt,
    })

    const uploadStartedAt = Date.now()

    const uploadResults = await Promise.allSettled(
        downloadedTracks.map(({index, preparedTrack, track}) =>
            limit(async () => {
                try {
                    const audio = await uploadAudio(
                        sdk,
                        env,
                        sandboxId,
                        preparedTrack,
                        {
                            importId: cardImport.id,
                            cardId,
                            trackId: track.id,
                            trackTitle: track.title,
                        },
                    )
                    trackProgress[index].uploaded = true
                    if (audio.alreadyTranscoded) {
                        trackProgress[index].ready = true
                    }
                    await reportProgress()
                    return {index, audio, track}
                } finally {
                    await removeTrack(env, sandboxId, preparedTrack)
                }
            }),
        ),
    )

    const failedUpload = uploadResults.find(
        (result): result is PromiseRejectedResult =>
            result.status === "rejected",
    )
    if (failedUpload) throw failedUpload.reason

    const importedTracks = uploadResults.map(result => {
        if (result.status !== "fulfilled") throw result.reason
        return result.value
    })

    const cacheHitCount = importedTracks.filter(
        track => track.audio.alreadyTranscoded,
    ).length

    logger.info({
        message: "import.audio.upload.completed",
        importId: cardImport.id,
        cardId,
        sandboxId,
        trackCount: importedTracks.length,
        cacheHitCount,
        uploadedCount: importedTracks.length - cacheHitCount,
        durationMs: Date.now() - uploadStartedAt,
    })
    logger.info({
        message: "import.video.completed",
        importId: cardImport.id,
        cardId,
        sourceCount: videos.length,
        trackCount: importedTracks.length,
        durationMs: Date.now() - startedAt,
    })

    return importedTracks
}

async function transcodeAudio(
    sdk: YotoSdk,
    cardImport: Pick<Import, "id" | "cardId">,
    importedTracks: ImportedTrack[],
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
): Promise<TranscodedTrack[]> {
    const startedAt = Date.now()
    const {id: importId, cardId} = cardImport
    const limit = pLimit(CONCURRENCY_LIMIT)
    const total = importedTracks.length
    const transcodedTracks: (TranscodedTrack | undefined)[] = Array(total)
    const trackProgress = importedTracks.map(({audio, track}) => ({
        duration: track.duration,
        prepared: true,
        uploaded: true,
        ready: audio.alreadyTranscoded,
    }))
    const reportProgress = createProgressReporter(trackProgress, onProgress)
    await reportProgress()
    let pending: PendingTranscode[] = []

    const reportCompletedTrack = async (position: number) => {
        trackProgress[position].ready = true
        await reportProgress()
    }

    for (const [position, importedTrack] of importedTracks.entries()) {
        const {index, audio, track} = importedTrack
        if (audio.alreadyTranscoded) {
            transcodedTracks[position] = {
                index,
                track,
                audio: {
                    key: audio.key,
                    duration: audio.duration,
                    fileSize: audio.fileSize,
                },
            }
            continue
        }

        pending.push({
            position,
            importedTrack: {
                ...importedTrack,
                audio,
            },
            startedAt: Date.now(),
        })
    }

    for (
        let attempt = 1;
        attempt <= TRANSCODE_MAX_ATTEMPTS && pending.length > 0;
        attempt++
    ) {
        if (attempt > 1) {
            await new Promise(resolve =>
                setTimeout(resolve, TRANSCODE_POLL_INTERVAL),
            )
        }

        const pollResults = await Promise.all(
            pending.map(pendingTranscode =>
                limit(async () => {
                    const {audio, track} = pendingTranscode.importedTrack
                    const result = await pollTranscode(
                        sdk,
                        audio.sha256,
                        {
                            importId,
                            cardId,
                            trackId: track.id,
                            trackTitle: track.title,
                        },
                        attempt,
                        pendingTranscode.startedAt,
                    )
                    return {pendingTranscode, result}
                }),
            ),
        )

        pending = []
        for (const {pendingTranscode, result} of pollResults) {
            if (!result) {
                pending.push(pendingTranscode)
                continue
            }

            const {index, track} = pendingTranscode.importedTrack
            transcodedTracks[pendingTranscode.position] = {
                index,
                track,
                audio: result,
            }
            await reportCompletedTrack(pendingTranscode.position)
        }
    }

    if (pending.length > 0) {
        for (const {importedTrack, startedAt: trackStartedAt} of pending) {
            logger.error({
                message: "yoto.audio.transcode.timed_out",
                importId,
                cardId,
                trackId: importedTrack.track.id,
                trackTitle: importedTrack.track.title,
                sha256: importedTrack.audio.sha256,
                attempts: TRANSCODE_MAX_ATTEMPTS,
                durationMs: Date.now() - trackStartedAt,
            })
        }
        throw new Error("Audio transcode timed out")
    }

    const completedTracks = transcodedTracks.map(track => {
        if (!track) throw new Error("Audio transcode result missing")
        return track
    })

    const cacheHitCount = importedTracks.filter(
        track => track.audio.alreadyTranscoded,
    ).length
    logger.info({
        message: "import.audio.transcode.completed",
        importId,
        cardId,
        trackCount: completedTracks.length,
        cacheHitCount,
        transcodedCount: completedTracks.length - cacheHitCount,
        durationMs: Date.now() - startedAt,
    })

    return completedTracks
}

async function updateCard(
    sdk: YotoSdk,
    cardImport: Pick<Import, "id" | "cardId">,
    transcodedTracks: TranscodedTrack[],
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
): Promise<ImportSuccess> {
    const startedAt = Date.now()
    const {id: importId, cardId} = cardImport
    const trackProgress = transcodedTracks.map(({track}) => ({
        duration: track.duration,
        prepared: true,
        uploaded: true,
        ready: true,
    }))
    const reportProgress = createProgressReporter(trackProgress, onProgress)
    await reportProgress(false, "finalizing")

    const fetchStartedAt = Date.now()
    const card = (await sdk.content.getCard(
        cardId,
    )) as unknown as YotoCard | null
    const fetchDurationMs = Date.now() - fetchStartedAt
    if (!card) throw new Error("Card not found")

    const chapters: YotoChapter[] = [...(card.content?.chapters ?? [])]
    const orderedTracks = [...transcodedTracks].sort(
        (first, second) => first.index - second.index,
    )

    for (const {audio, track} of orderedTracks) {
        const nextKey = getNextChapterKey(chapters)
        chapters.push(
            createChapter(
                track.title,
                audio.key,
                parseInt(nextKey, 10) + 1,
                audio.duration,
                audio.fileSize,
            ),
        )
    }

    const updatedCard: YotoCard = {
        cardId,
        title: card.title,
        content: {
            ...card.content,
            chapters: stripNullValues(chapters),
        },
        metadata: card.metadata,
    }

    const updateStartedAt = Date.now()
    await sdk.content.updateCard(
        updatedCard as unknown as Parameters<typeof sdk.content.updateCard>[0],
    )
    const updateDurationMs = Date.now() - updateStartedAt
    await reportProgress(true, "finalizing")

    const added = transcodedTracks.length
    logger.info({
        message: "import.card.update.completed",
        importId,
        cardId,
        trackCount: added,
        fetchDurationMs,
        updateDurationMs,
        durationMs: Date.now() - startedAt,
    })

    return {
        status: "success",
        message: `Added ${added} track${added !== 1 ? "s" : ""}`,
        added,
        skipped: 0,
    }
}

export {
    createAudioTracks,
    importVideo,
    inspectVideo,
    transcodeAudio,
    updateCard,
}
export type {ImportedTrack, TranscodedTrack}
