import {createHash} from "node:crypto"
import {existsSync, readFileSync, rmSync, statSync} from "node:fs"
import {mkdtemp} from "node:fs/promises"
import {tmpdir} from "node:os"
import {basename, join} from "node:path"

import {getAuthenticatedSdk, type getYotoSdk} from "./auth.server"
import {setPlaylistAssociation} from "./playlists.server"
import {
    createChapter,
    type ImportProgress,
    stripNullValues,
    type YotoChapter,
} from "./sync-utils"
import {addSyncedTrack, getSyncedVideoIds} from "./tracks.server"
import {
    downloadTrack,
    extractPlaylistId,
    getPlaylistInfo,
    isPlaylistUrl,
} from "./youtube.server"

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

// Calculate SHA256 hash of a file
const calculateFileSha256 = (filePath: string): string => {
    const content = readFileSync(filePath)
    return createHash("sha256").update(content).digest("hex")
}

// Upload audio file and wait for transcode
const uploadAudio = async (
    sdk: Awaited<ReturnType<typeof getYotoSdk>>,
    filePath: string,
    onProgress?: () => void | Promise<void>,
): Promise<{key: string; duration: number; fileSize: number}> => {
    const sha256 = calculateFileSha256(filePath)
    const filename = basename(filePath)

    type TranscodeResult = {
        progress?: {phase: string}
        transcodedSha256?: string
        transcodedInfo?: {duration: number; fileSize: number}
    }

    // Check if already transcoded
    try {
        const existingStatus = (await sdk.media.getTranscodedUpload(
            sha256,
            false,
        )) as unknown as TranscodeResult

        if (
            existingStatus?.progress?.phase === "complete" &&
            existingStatus.transcodedSha256
        ) {
            return {
                key: existingStatus.transcodedSha256,
                duration: existingStatus.transcodedInfo?.duration ?? 0,
                fileSize: existingStatus.transcodedInfo?.fileSize ?? 0,
            }
        }
    } catch {
        // File doesn't exist yet, continue with upload
    }

    // Get upload URL
    const uploadInfo = (await sdk.media.getUploadUrlForTranscode(
        sha256,
        filename,
    )) as unknown as {uploadId: string; uploadUrl: string | null}

    if (uploadInfo.uploadUrl) {
        const fileContent = readFileSync(filePath)
        const fileStats = statSync(filePath)

        const uploadResponse = await fetch(uploadInfo.uploadUrl, {
            method: "PUT",
            body: fileContent,
            headers: {
                "Content-Type": "audio/mpeg",
                "Content-Length": fileStats.size.toString(),
            },
        })

        if (!uploadResponse.ok) {
            throw new Error(`Upload failed: ${uploadResponse.statusText}`)
        }
    }

    // Poll for transcode completion
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

            if (
                transcodeStatus?.progress?.phase === "complete" &&
                transcodeStatus.transcodedSha256
            ) {
                return {
                    key: transcodeStatus.transcodedSha256,
                    duration: transcodeStatus.transcodedInfo?.duration ?? 0,
                    fileSize: transcodeStatus.transcodedInfo?.fileSize ?? 0,
                }
            }
        } catch {
            // Continue polling
        }
    }

    throw new Error("Audio transcode timed out")
}

type SyncToCardResult =
    | {
          success: true
          message: string
          added: number
          skipped: number
      }
    | {error: string}

/**
 * Sync YouTube content directly to an existing card.
 */
export async function performSyncToCard(
    youtubeUrl: string,
    cardId: string,
    onProgress?: (progress: ImportProgress) => void | Promise<void>,
): Promise<SyncToCardResult> {
    const sdk = await getAuthenticatedSdk()
    const tempDir = await mkdtemp(join(tmpdir(), "yoto-"))

    try {
        // 1. Fetch YouTube playlist/video info
        await onProgress?.({phase: "fetching"})
        const youtubeInfo = await getPlaylistInfo(youtubeUrl)
        const youtubePlaylistId = isPlaylistUrl(youtubeUrl)
            ? extractPlaylistId(youtubeUrl)
            : youtubeInfo.id

        // 2. Get existing card - getCard returns the card directly
        const cardResponse = (await sdk.content.getCard(
            cardId,
        )) as unknown as YotoCard | null

        if (!cardResponse) {
            return {error: "Card not found"}
        }

        const existingChapters = cardResponse.content?.chapters ?? []
        const cardTitle = cardResponse.title ?? "Untitled Card"

        // 3. Check which tracks are already synced
        const syncedVideoIds = getSyncedVideoIds(cardId)
        const tracksToAdd = youtubeInfo.tracks.filter(
            t => !syncedVideoIds.has(t.id),
        )

        if (tracksToAdd.length === 0) {
            return {
                success: true,
                message: "All tracks already synced!",
                added: 0,
                skipped: youtubeInfo.tracks.length,
            }
        }

        // 4. Download and upload new tracks
        const newChapters: YotoChapter[] = [...existingChapters]
        const uploadedTracks: Array<{
            track: (typeof tracksToAdd)[0]
            chapter: YotoChapter
        }> = []

        for (let i = 0; i < tracksToAdd.length; i++) {
            const track = tracksToAdd[i]

            // Download
            await onProgress?.({
                phase: "downloading",
                current: i + 1,
                total: tracksToAdd.length,
                title: track.title,
            })
            const filePath = await downloadTrack(track, tempDir)

            // Upload
            await onProgress?.({
                phase: "uploading",
                current: i + 1,
                total: tracksToAdd.length,
                title: track.title,
            })
            const uploaded = await uploadAudio(sdk, filePath, async () => {
                await onProgress?.({
                    phase: "transcoding",
                    current: i + 1,
                    total: tracksToAdd.length,
                    title: track.title,
                })
            })

            // Create chapter
            const chapter = createChapter(
                track.title,
                uploaded.key,
                newChapters.length + 1,
                uploaded.duration,
                uploaded.fileSize,
            )
            newChapters.push(chapter)
            uploadedTracks.push({track, chapter})
        }

        // 5. Update card with new chapters
        await onProgress?.({phase: "updating"})
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

        // 6. Record synced tracks AFTER card update succeeds
        for (const {track, chapter} of uploadedTracks) {
            addSyncedTrack(cardId, {
                youtubeVideoId: track.id,
                title: track.title,
                syncedAt: new Date().toISOString(),
                yotoTrackKey: chapter.key,
            })
        }

        const addedCount = uploadedTracks.length

        // 7. Save playlist association
        setPlaylistAssociation(youtubePlaylistId, {
            yotoId: cardId,
            yotoName: cardTitle,
            youtubeName: youtubeInfo.title,
            lastSynced: new Date().toISOString(),
        })

        return {
            success: true,
            message: `Added ${addedCount} track${addedCount !== 1 ? "s" : ""}, skipped ${youtubeInfo.tracks.length - addedCount} already synced`,
            added: addedCount,
            skipped: youtubeInfo.tracks.length - addedCount,
        }
    } catch (error) {
        console.error("Sync to card failed:", error)
        return {
            error:
                error instanceof Error
                    ? error.message
                    : "Sync failed. Please try again.",
        }
    } finally {
        // Clean up temp directory
        if (existsSync(tempDir)) {
            rmSync(tempDir, {recursive: true, force: true})
        }
    }
}
