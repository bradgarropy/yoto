import type {YotoSdk} from "@yotoplay/yoto-sdk"
import pLimit, {type LimitFunction} from "p-limit"

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

type PlannedTrack = {
    index: number
    track: AudioTrack
}

type PreparedTrack = PlannedTrack & {
    preparedTrack: Track
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

const CONCURRENCY_LIMIT = 5
const TRANSCODE_MAX_ATTEMPTS = 60
const TRANSCODE_POLL_INTERVAL = 5000
const YOTO_CARD_TRACK_LIMIT = 100

class CardCapacityError extends Error {
    override readonly name = "CardCapacityError"

    constructor(
        readonly existingTrackCount: number,
        readonly incomingTrackCount: number,
    ) {
        const formatTracks = (count: number) =>
            `${count} track${count === 1 ? "" : "s"}`

        super(
            `This import would exceed Yoto's ${YOTO_CARD_TRACK_LIMIT}-track card limit. ` +
                `This card has ${formatTracks(existingTrackCount)} and the import contains ${formatTracks(incomingTrackCount)}.`,
        )
    }
}

function assertCardCapacity(
    existingTrackCount: number,
    incomingTrackCount: number,
): void {
    if (existingTrackCount + incomingTrackCount > YOTO_CARD_TRACK_LIMIT) {
        throw new CardCapacityError(existingTrackCount, incomingTrackCount)
    }
}

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

async function transcodeTrack(
    sdk: YotoSdk,
    cardImport: Pick<Import, "id" | "cardId">,
    importedTrack: ImportedTrack,
    pollLimit: LimitFunction,
): Promise<TranscodedTrack> {
    const {audio, index, track} = importedTrack

    if (audio.alreadyTranscoded) {
        return {
            index,
            track,
            audio: {
                key: audio.key,
                duration: audio.duration,
                fileSize: audio.fileSize,
            },
        }
    }

    const {id: importId, cardId} = cardImport
    const startedAt = Date.now()
    const context = {
        importId,
        cardId,
        trackId: track.id,
        trackTitle: track.title,
    }

    for (let attempt = 1; attempt <= TRANSCODE_MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
            await new Promise(resolve =>
                setTimeout(resolve, TRANSCODE_POLL_INTERVAL),
            )
        }

        const result = await pollLimit(() =>
            pollTranscode(sdk, audio.sha256, context, attempt, startedAt),
        )

        if (result) return {index, track, audio: result}
    }

    logger.error({
        message: "yoto.audio.transcode.timed_out",
        ...context,
        sha256: audio.sha256,
        attempts: TRANSCODE_MAX_ATTEMPTS,
        durationMs: Date.now() - startedAt,
    })
    throw new Error("Audio transcode timed out")
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

async function checkCardCapacity(
    sdk: YotoSdk,
    cardImport: Pick<Import, "cardId" | "splitByChapters">,
    videos: YouTubeVideo[],
): Promise<void> {
    const startedAt = Date.now()
    const card = (await sdk.content.getCard(
        cardImport.cardId,
    )) as unknown as YotoCard | null
    if (!card) throw new Error("Card not found")

    const existingTrackCount = card.content?.chapters?.length ?? 0
    const incomingTrackCount = createAudioTracks(
        videos,
        cardImport.splitByChapters,
    ).length

    assertCardCapacity(existingTrackCount, incomingTrackCount)

    logger.info({
        message: "import.card.capacity.checked",
        cardId: cardImport.cardId,
        existingTrackCount,
        incomingTrackCount,
        durationMs: Date.now() - startedAt,
    })
}

async function prepareSourceTracks(
    env: Env,
    sandboxId: string,
    video: YouTubeVideo,
    tracks: PlannedTrack[],
): Promise<PreparedTrack[]> {
    const preparedTracks = await prepareTracks(
        env,
        sandboxId,
        video,
        tracks.map(({track}) => track),
    )

    if (preparedTracks.length !== tracks.length) {
        await Promise.allSettled(
            preparedTracks.map(track => removeTrack(env, sandboxId, track)),
        )
        throw new Error(`Failed to prepare every track for ${video.title}`)
    }

    return preparedTracks.map((preparedTrack, index) => ({
        ...tracks[index],
        preparedTrack,
    }))
}

async function processPreparedTrack(
    sdk: YotoSdk,
    env: Env,
    sandboxId: string,
    cardImport: Pick<Import, "id" | "cardId">,
    preparedTrack: PreparedTrack,
    uploadLimit: LimitFunction,
    pollLimit: LimitFunction,
    onUploaded: (alreadyTranscoded: boolean) => void | Promise<void>,
    onReady: () => void | Promise<void>,
): Promise<TranscodedTrack> {
    const {index, preparedTrack: audioFile, track} = preparedTrack
    let audio: AudioUploadResult

    try {
        audio = await uploadLimit(() =>
            uploadAudio(sdk, env, sandboxId, audioFile, {
                importId: cardImport.id,
                cardId: cardImport.cardId,
                trackId: track.id,
                trackTitle: track.title,
            }),
        )
    } finally {
        await removeTrack(env, sandboxId, audioFile)
    }

    await onUploaded(audio.alreadyTranscoded)
    const transcodedTrack = await transcodeTrack(
        sdk,
        cardImport,
        {index, track, audio},
        pollLimit,
    )

    if (!audio.alreadyTranscoded) await onReady()
    return transcodedTrack
}

async function processAudio(
    sdk: YotoSdk,
    env: Env,
    cardImport: Import,
    videos: YouTubeVideo[],
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
): Promise<TranscodedTrack[]> {
    const startedAt = Date.now()
    const {id: importId, cardId} = cardImport
    const sandboxId = getImportSandboxId(cardImport)
    const prepareLimit = pLimit(CONCURRENCY_LIMIT)
    const uploadLimit = pLimit(CONCURRENCY_LIMIT)
    const pollLimit = pLimit(CONCURRENCY_LIMIT)
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
    await reportProgress()

    let cacheHitCount = 0
    const preparationStartedAt = Date.now()
    const preparationPromises = sourcePlans.map(({video, tracks}) =>
        prepareLimit(async () => {
            const preparedTracks = await prepareSourceTracks(
                env,
                sandboxId,
                video,
                tracks,
            )
            tracks.forEach(({index}) => {
                trackProgress[index].prepared = true
            })
            await reportProgress()
            return preparedTracks
        }),
    )
    const preparationSummary = Promise.allSettled(preparationPromises).then(
        results => {
            logger.info({
                message: "import.audio.prepare.completed",
                importId,
                cardId,
                sandboxId,
                sourceCount: videos.length,
                trackCount: results.reduce(
                    (total, result) =>
                        total +
                        (result.status === "fulfilled"
                            ? result.value.length
                            : 0),
                    0,
                ),
                failedSourceCount: results.filter(
                    result => result.status === "rejected",
                ).length,
                durationMs: Date.now() - preparationStartedAt,
            })
        },
    )

    const pipelineResults = await Promise.allSettled(
        preparationPromises.map(async preparedSource => {
            const preparedTracks = await preparedSource

            return Promise.allSettled(
                preparedTracks.map(preparedTrack =>
                    processPreparedTrack(
                        sdk,
                        env,
                        sandboxId,
                        cardImport,
                        preparedTrack,
                        uploadLimit,
                        pollLimit,
                        async alreadyTranscoded => {
                            const {index} = preparedTrack
                            trackProgress[index].uploaded = true
                            trackProgress[index].ready = alreadyTranscoded
                            if (alreadyTranscoded) cacheHitCount++
                            await reportProgress()
                        },
                        async () => {
                            trackProgress[preparedTrack.index].ready = true
                            await reportProgress()
                        },
                    ),
                ),
            )
        }),
    )
    await preparationSummary

    const failedPipeline = pipelineResults.find(
        result => result.status === "rejected",
    )
    if (failedPipeline?.status === "rejected") {
        throw failedPipeline.reason
    }
    const trackResults = pipelineResults.flatMap(result => {
        if (result.status === "rejected") throw result.reason
        return result.value
    })
    const failedTrack = trackResults.find(
        result => result.status === "rejected",
    )
    if (failedTrack?.status === "rejected") throw failedTrack.reason

    const transcodedTracks = trackResults.map(result => {
        if (result.status === "rejected") throw result.reason
        return result.value
    })

    logger.info({
        message: "import.audio.pipeline.completed",
        importId,
        cardId,
        sandboxId,
        sourceCount: videos.length,
        trackCount: transcodedTracks.length,
        cacheHitCount,
        uploadedCount: transcodedTracks.length - cacheHitCount,
        durationMs: Date.now() - startedAt,
    })

    return transcodedTracks
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
    assertCardCapacity,
    checkCardCapacity,
    createAudioTracks,
    inspectVideo,
    processAudio,
    updateCard,
    YOTO_CARD_TRACK_LIMIT,
}
export {CardCapacityError}
export type {TranscodedTrack}
