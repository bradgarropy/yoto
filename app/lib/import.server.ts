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
    getNextChapterKey,
    type ImportProgress,
    stripNullValues,
    type YotoChapter,
} from "~/lib/import-utils"
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
    cardId: string
    trackId: string
    trackTitle: string
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
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

    // Check if already transcoded
    try {
        const existingStatus = (await sdk.media.getTranscodedUpload(
            sha256,
            false,
        )) as unknown as TranscodeResult

        console.info("Yoto audio transcode cache lookup", {
            ...context,
            sha256,
            phase: existingStatus?.progress?.phase,
        })

        if (
            existingStatus?.progress?.phase === "complete" &&
            existingStatus.transcodedSha256
        ) {
            console.info("Yoto audio already transcoded", {
                ...context,
                sha256,
                transcodedSha256: existingStatus.transcodedSha256,
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
        console.info("Yoto audio transcode cache miss", {
            ...context,
            sha256,
            error: getErrorMessage(error),
        })
    }

    // Get upload URL
    const uploadInfo = (await sdk.media.getUploadUrlForTranscode(
        sha256,
        track.filename,
    )) as unknown as {uploadId: string; uploadUrl: string | null}

    if (uploadInfo.uploadUrl) {
        console.info("Yoto audio upload starting", {
            ...context,
            sha256,
            uploadId: uploadInfo.uploadId,
            bytes: track.byteLength,
        })

        await uploadTrack(env, sandboxId, track, uploadInfo.uploadUrl)

        console.info("Yoto audio upload complete", {
            ...context,
            sha256,
            uploadId: uploadInfo.uploadId,
        })
    } else {
        console.info("Yoto audio upload skipped", {
            ...context,
            sha256,
            uploadId: uploadInfo.uploadId,
        })
    }

    return {alreadyTranscoded: false, sha256}
}

// Poll for transcode completion
async function waitForTranscode(
    sdk: YotoSdk,
    sha256: string,
    context: AudioLogContext,
    onProgress?: () => void | Promise<void>,
): Promise<{key: string; duration: number; fileSize: number}> {
    const maxAttempts = 60
    const pollInterval = 5000

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        await onProgress?.()

        try {
            const transcodeStatus = (await sdk.media.getTranscodedUpload(
                sha256,
                false,
            )) as unknown as TranscodeResult

            console.info("Yoto audio transcode poll", {
                ...context,
                sha256,
                attempt: attempt + 1,
                maxAttempts,
                phase: transcodeStatus?.progress?.phase,
            })

            if (
                transcodeStatus?.progress?.phase === "complete" &&
                transcodeStatus.transcodedSha256
            ) {
                console.info("Yoto audio transcode complete", {
                    ...context,
                    sha256,
                    transcodedSha256: transcodeStatus.transcodedSha256,
                    duration: transcodeStatus.transcodedInfo?.duration,
                    fileSize: transcodeStatus.transcodedInfo?.fileSize,
                })
                return {
                    key: transcodeStatus.transcodedSha256,
                    duration: transcodeStatus.transcodedInfo?.duration ?? 0,
                    fileSize: transcodeStatus.transcodedInfo?.fileSize ?? 0,
                }
            }
        } catch (error) {
            // Continue polling
            console.warn("Yoto audio transcode poll failed", {
                ...context,
                sha256,
                attempt: attempt + 1,
                maxAttempts,
                error: getErrorMessage(error),
            })
        }
    }

    console.error("Yoto audio transcode timed out", {
        ...context,
        sha256,
        attempts: maxAttempts,
    })
    throw new Error("Audio transcode timed out")
}

// Concurrency limit for parallel operations
const CONCURRENCY_LIMIT = 5

async function inspectVideo(
    env: Env,
    cardImport: Import,
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
): Promise<YouTubeVideo[]> {
    await onProgress?.({phase: "preparing"})
    const youtubeInfo = await getPlaylistInfo(
        env,
        getImportSandboxId(cardImport),
        cardImport.youtubeUrl,
    )
    return youtubeInfo.videos
}

async function importVideo(
    sdk: YotoSdk,
    env: Env,
    cardImport: Import,
    videos: YouTubeVideo[],
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
): Promise<ImportedTrack[]> {
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
    const total = nextTrackIndex

    let downloadedCount = 0
    await onProgress?.({phase: "downloading", current: 1, total})

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

                downloadedCount += preparedTracks.length
                if (downloadedCount < total) {
                    await onProgress?.({
                        phase: "downloading",
                        current: downloadedCount + 1,
                        total,
                    })
                }
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

    let uploadedCount = 0
    await onProgress?.({phase: "uploading", current: 1, total})

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
                            cardId,
                            trackId: track.id,
                            trackTitle: track.title,
                        },
                    )
                    uploadedCount++
                    if (uploadedCount < total) {
                        await onProgress?.({
                            phase: "uploading",
                            current: uploadedCount + 1,
                            total,
                        })
                    }
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

    return uploadResults.map(result => {
        if (result.status !== "fulfilled") throw result.reason
        return result.value
    })
}

async function transcodeAudio(
    sdk: YotoSdk,
    cardId: string,
    importedTracks: ImportedTrack[],
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
): Promise<TranscodedTrack[]> {
    const limit = pLimit(CONCURRENCY_LIMIT)
    const total = importedTracks.length
    let transcodedCount = 0
    await onProgress?.({phase: "transcoding", current: 1, total})

    return Promise.all(
        importedTracks.map(({index, audio, track}) =>
            limit(async () => {
                const transcoded = audio.alreadyTranscoded
                    ? {
                          key: audio.key,
                          duration: audio.duration,
                          fileSize: audio.fileSize,
                      }
                    : await waitForTranscode(sdk, audio.sha256, {
                          cardId,
                          trackId: track.id,
                          trackTitle: track.title,
                      })

                transcodedCount++
                if (transcodedCount < total) {
                    await onProgress?.({
                        phase: "transcoding",
                        current: transcodedCount + 1,
                        total,
                    })
                }
                return {index, audio: transcoded, track}
            }),
        ),
    )
}

async function updateCard(
    sdk: YotoSdk,
    cardId: string,
    transcodedTracks: TranscodedTrack[],
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
): Promise<ImportSuccess> {
    await onProgress?.({phase: "finalizing"})

    const card = (await sdk.content.getCard(
        cardId,
    )) as unknown as YotoCard | null
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

    await sdk.content.updateCard(
        updatedCard as unknown as Parameters<typeof sdk.content.updateCard>[0],
    )

    const added = transcodedTracks.length
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
