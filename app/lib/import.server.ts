import type {YotoSdk} from "@yotoplay/yoto-sdk"
import pLimit from "p-limit"

import {getImportSandboxId, type Import} from "./import"
import {
    createChapter,
    getNextChapterKey,
    type ImportProgress,
    stripNullValues,
    type YotoChapter,
} from "./import-utils"
import {
    getPlaylistInfo,
    prepareTrack,
    removeTrack,
    type Track,
    uploadTrack,
} from "./sandbox.server"

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

type AudioLogContext = {
    cardId: string
    trackId: string
    trackTitle: string
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
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

type ImportToCardResult =
    | {
          success: true
          message: string
          added: number
          skipped: number
      }
    | {error: string}

// Concurrency limit for parallel operations
const CONCURRENCY_LIMIT = 5

/**
 * Import YouTube content directly to an existing card.
 * Processes tracks in parallel phases: download → upload → transcode
 */
export async function performImportToCard(
    sdk: YotoSdk,
    env: Env,
    cardImport: Import,
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
): Promise<ImportToCardResult> {
    const {cardId, youtubeUrl} = cardImport
    const sandboxId = getImportSandboxId(cardImport)
    const limit = pLimit(CONCURRENCY_LIMIT)

    try {
        // 1. Fetch YouTube playlist/video info via sandbox
        await onProgress?.({phase: "preparing"})
        const youtubeInfo = await getPlaylistInfo(env, sandboxId, youtubeUrl)

        // 2. Get existing card
        const cardResponse = (await sdk.content.getCard(
            cardId,
        )) as unknown as YotoCard | null

        if (!cardResponse) {
            return {error: "Card not found"}
        }

        const existingChapters = cardResponse.content?.chapters ?? []
        const tracksToAdd = youtubeInfo.videos
        const total = tracksToAdd.length

        // 3. Download phase - download all tracks in parallel (5 at a time)
        let downloadedCount = 0
        await onProgress?.({phase: "downloading", current: 1, total})

        const downloadResults = await Promise.allSettled(
            tracksToAdd.map((track, index) =>
                limit(async () => {
                    const preparedTrack = await prepareTrack(
                        env,
                        sandboxId,
                        track,
                    )
                    downloadedCount++
                    // Report next track in progress (if there are more)
                    if (downloadedCount < total) {
                        await onProgress?.({
                            phase: "downloading",
                            current: downloadedCount + 1,
                            total,
                        })
                    }
                    return {index, preparedTrack, track}
                }),
            ),
        )

        const failedDownload = downloadResults.find(
            (result): result is PromiseRejectedResult =>
                result.status === "rejected",
        )

        if (failedDownload) {
            await Promise.allSettled(
                downloadResults
                    .filter(
                        (
                            result,
                        ): result is PromiseFulfilledResult<{
                            index: number
                            preparedTrack: Track
                            track: (typeof tracksToAdd)[number]
                        }> => result.status === "fulfilled",
                    )
                    .map(({value}) =>
                        removeTrack(env, sandboxId, value.preparedTrack),
                    ),
            )
            throw failedDownload.reason
        }

        const downloadedTracks = downloadResults.map(result => {
            if (result.status !== "fulfilled") throw result.reason
            return result.value
        })

        // 4. Upload phase - upload all tracks in parallel (5 at a time)
        let uploadedCount = 0
        await onProgress?.({phase: "uploading", current: 1, total})

        const settledUploads = await Promise.allSettled(
            downloadedTracks.map(({index, preparedTrack, track}) =>
                limit(async () => {
                    try {
                        const result = await uploadAudio(
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
                        // Report next track in progress (if there are more)
                        if (uploadedCount < total) {
                            await onProgress?.({
                                phase: "uploading",
                                current: uploadedCount + 1,
                                total,
                            })
                        }
                        return {index, result, track}
                    } finally {
                        await removeTrack(env, sandboxId, preparedTrack)
                    }
                }),
            ),
        )

        const failedUpload = settledUploads.find(
            (result): result is PromiseRejectedResult =>
                result.status === "rejected",
        )
        if (failedUpload) throw failedUpload.reason

        const uploadResults = settledUploads.map(result => {
            if (result.status !== "fulfilled") throw result.reason
            return result.value
        })

        // 5. Transcode phase - wait for all transcodes in parallel (5 at a time)
        let transcodedCount = 0
        await onProgress?.({phase: "transcoding", current: 1, total})

        const transcodeResults = await Promise.all(
            uploadResults.map(({index, result, track}) =>
                limit(async () => {
                    let transcoded: {
                        key: string
                        duration: number
                        fileSize: number
                    }

                    if (result.alreadyTranscoded) {
                        // Already transcoded, use cached result
                        transcoded = {
                            key: result.key,
                            duration: result.duration,
                            fileSize: result.fileSize,
                        }
                    } else {
                        // Wait for transcode to complete
                        transcoded = await waitForTranscode(
                            sdk,
                            result.sha256,
                            {
                                cardId,
                                trackId: track.id,
                                trackTitle: track.title,
                            },
                        )
                    }

                    transcodedCount++
                    // Report next track in progress (if there are more)
                    if (transcodedCount < total) {
                        await onProgress?.({
                            phase: "transcoding",
                            current: transcodedCount + 1,
                            total,
                        })
                    }
                    return {index, transcoded, track}
                }),
            ),
        )

        // 6. Build chapters in order
        const newChapters: YotoChapter[] = [...existingChapters]

        // Sort by original index to maintain track order
        transcodeResults.sort((a, b) => a.index - b.index)

        for (const {transcoded, track} of transcodeResults) {
            const nextKey = getNextChapterKey(newChapters)
            const position = parseInt(nextKey, 10) + 1

            const chapter = createChapter(
                track.title,
                transcoded.key,
                position,
                transcoded.duration,
                transcoded.fileSize,
            )

            newChapters.push(chapter)
        }

        // 7. Update card with new chapters
        await onProgress?.({phase: "finalizing"})
        const cleanedChapters = stripNullValues(newChapters)

        const updatedCard: YotoCard = {
            cardId,
            title: cardResponse.title,
            content: {
                ...cardResponse.content,
                chapters: cleanedChapters,
            },
            metadata: cardResponse.metadata,
        }

        await sdk.content.updateCard(
            updatedCard as unknown as Parameters<
                typeof sdk.content.updateCard
            >[0],
        )

        const addedCount = tracksToAdd.length

        return {
            success: true,
            message: `Added ${addedCount} track${addedCount !== 1 ? "s" : ""}`,
            added: addedCount,
            skipped: 0,
        }
    } catch (error) {
        console.error("Import to card failed:", error)
        return {
            error:
                error instanceof Error
                    ? error.message
                    : "Import failed. Please try again.",
        }
    }
}
