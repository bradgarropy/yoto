import {createHash} from "node:crypto"
import {existsSync, readFileSync, rmSync, statSync} from "node:fs"
import {mkdir} from "node:fs/promises"
import {homedir} from "node:os"
import {basename, join} from "node:path"

import type {getYotoSdk} from "@yoto/core/auth"
import {setPlaylistAssociation} from "@yoto/core/playlists"
import {
    downloadTrack,
    extractPlaylistId,
    getPlaylistInfo,
    isPlaylistUrl,
} from "@yoto/core/youtube"

import {getAuthenticatedSdk} from "./auth.server"
import {createChapter, stripNullValues, type YotoChapter} from "./sync-utils"
import {addSyncedTrack, getSyncedVideoIds} from "./tracks.server"

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

type SyncResult =
    | {
          success: true
          message: string
          cardId: string
          added: number
          skipped: number
      }
    | {error: string}

export async function performSync(
    youtubeUrl: string,
    cardId: string | null,
    newCardName: string | null,
): Promise<SyncResult> {
    const sdk = await getAuthenticatedSdk()
    const tempDir = join(homedir(), "Desktop", "yoto-temp")
    await mkdir(tempDir, {recursive: true})

    try {
        // 1. Fetch YouTube playlist/video info
        const youtubeInfo = await getPlaylistInfo(youtubeUrl)
        // For single videos, use the video ID as the playlist ID
        const youtubePlaylistId = isPlaylistUrl(youtubeUrl)
            ? extractPlaylistId(youtubeUrl)
            : youtubeInfo.id

        // 2. Determine target card
        let targetCardId = cardId
        let targetCardTitle = ""

        if (cardId === "new" || !cardId) {
            // Create new card
            const cardData = {
                title: newCardName || youtubeInfo.title,
                content: {
                    activity: "yoto_Player",
                    chapters: [],
                    restricted: true,
                    config: {onlineOnly: false},
                    version: "1",
                },
                metadata: {
                    cover: {
                        imageL: "https://cdn.yoto.io/myo-cover/bee_grapefruit.gif",
                    },
                    media: {},
                },
            }

            const result = (await sdk.content.updateCard(
                cardData as unknown as Parameters<
                    typeof sdk.content.updateCard
                >[0],
            )) as YotoCard

            targetCardId = result.cardId ?? ""
            targetCardTitle = (result.title ?? newCardName) || youtubeInfo.title
        } else {
            // Get existing card title - getCard returns the card directly
            const card = (await sdk.content.getCard(cardId)) as unknown as {
                title?: string
            }
            targetCardTitle = card?.title ?? "Untitled Card"
        }

        // 3. Get current card content - getCard returns the card directly
        const cardResponse = (await sdk.content.getCard(
            targetCardId!,
        )) as unknown as YotoCard | null
        const existingChapters = cardResponse?.content?.chapters ?? []

        // 4. Check which tracks are already synced
        const syncedVideoIds = getSyncedVideoIds(targetCardId!)
        const tracksToAdd = youtubeInfo.tracks.filter(
            t => !syncedVideoIds.has(t.id),
        )

        if (tracksToAdd.length === 0) {
            return {
                success: true,
                message: "All tracks already synced!",
                cardId: targetCardId!,
                added: 0,
                skipped: youtubeInfo.tracks.length,
            }
        }

        // 5. Download and upload new tracks
        const newChapters: YotoChapter[] = [...existingChapters]
        const uploadedTracks: Array<{
            track: (typeof tracksToAdd)[0]
            chapter: YotoChapter
        }> = []

        for (const track of tracksToAdd) {
            // Download
            const filePath = await downloadTrack(track, tempDir)

            // Upload
            const uploaded = await uploadAudio(sdk, filePath)

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

        // 6. Update card with new chapters
        if (cardResponse && targetCardId) {
            // Strip null values from chapters (Yoto API rejects null values)
            const cleanedChapters = stripNullValues(newChapters)

            // Only include fields that the API accepts (match CLI implementation)
            const updatedCard: YotoCard = {
                cardId: targetCardId,
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
        }

        // 7. Record synced tracks AFTER card update succeeds
        for (const {track, chapter} of uploadedTracks) {
            addSyncedTrack(targetCardId!, {
                youtubeVideoId: track.id,
                title: track.title,
                syncedAt: new Date().toISOString(),
                yotoTrackKey: chapter.key,
            })
        }

        const addedCount = uploadedTracks.length

        // 8. Save playlist association
        setPlaylistAssociation(youtubePlaylistId, {
            yotoId: targetCardId!,
            yotoName: targetCardTitle,
            youtubeName: youtubeInfo.title,
            lastSynced: new Date().toISOString(),
        })

        return {
            success: true,
            message: `Added ${addedCount} tracks, skipped ${youtubeInfo.tracks.length - addedCount} already synced`,
            cardId: targetCardId!,
            added: addedCount,
            skipped: youtubeInfo.tracks.length - addedCount,
        }
    } catch (error) {
        console.error("Sync failed:", error)
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
