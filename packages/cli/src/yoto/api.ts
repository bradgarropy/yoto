import {createHash} from "node:crypto"
import {readFileSync, statSync} from "node:fs"
import {basename} from "node:path"
import {requireAuth} from "~/yoto/auth"

const BASE_URL = "https://api.yotoplay.com"

// Types for Yoto API responses
type YotoTrack = {
    key: string
    title: string
    format: string
    trackUrl: string
    type: string
    duration?: number
    fileSize?: number
    channels?: string
    display?: {
        icon16x16?: string
    }
}

type YotoChapter = {
    key: string
    title: string
    tracks: YotoTrack[]
    display?: {
        icon16x16?: string
    }
    duration?: number
    fileSize?: number
}

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
    cardId: string
    title: string
    content: YotoContent
    metadata: YotoMetadata
    createdAt?: string
    updatedAt?: string
}

type YotoPlaylistSummary = {
    cardId: string
    title: string
}

type UploadUrlResponse = {
    upload: {
        uploadId: string
        uploadUrl: string
    }
}

type TranscodeStatusResponse = {
    transcode: {
        uploadId: string
        transcodedSha256?: string
        progress?: {
            phase: "pending" | "processing" | "complete" | "failed"
            percent: number
        }
        transcodedInfo?: {
            duration: number
            fileSize: number
        }
    }
}

// Helper for authenticated requests
const authFetch = async (
    path: string,
    options: RequestInit = {},
): Promise<Response> => {
    const token = requireAuth()

    const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json;charset=UTF-8",
        Origin: "https://my.yotoplay.com",
        Referer: "https://my.yotoplay.com/",
    }



    const response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers,
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
            `Yoto API error (${response.status}): ${errorText || response.statusText}`,
        )
    }

    return response
}

// List all playlists (GET /content/mine)
const listPlaylists = async (): Promise<YotoPlaylistSummary[]> => {
    const response = await authFetch("/content/mine")
    const data = (await response.json()) as {cards: YotoCard[]}

    return data.cards.map(card => ({
        cardId: card.cardId,
        title: card.title,
    }))
}

// Get a single playlist (GET /content/{cardId})
const getPlaylist = async (cardId: string): Promise<YotoCard> => {
    const response = await authFetch(`/content/${cardId}`)
    const data = (await response.json()) as {card: YotoCard}
    return data.card
}

// Create a new playlist (POST /content)
const createPlaylist = async (
    title: string,
    chapters: YotoChapter[] = [],
): Promise<YotoCard> => {
    const response = await authFetch("/content", {
        method: "POST",
        body: JSON.stringify({
            title,
            content: {
                activity: "yoto_Player",
                chapters,
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
        }),
    })

    const data = (await response.json()) as {card: YotoCard}
    return data.card
}

// Update an existing playlist (POST /content with cardId in body)
const updatePlaylist = async (
    cardId: string,
    updates: {
        title?: string
        chapters?: YotoChapter[]
    },
): Promise<YotoCard> => {
    // First fetch the existing playlist to preserve other fields
    const existing = await getPlaylist(cardId)

    // Build a clean update payload - only include necessary fields
    // Include cardId in body for updates (Yoto uses POST for both create and update)
    const updatedCard = {
        cardId: existing.cardId,
        title: updates.title ?? existing.title,
        content: {
            activity: existing.content.activity,
            chapters: updates.chapters ?? existing.content.chapters,
            restricted: existing.content.restricted,
            config: existing.content.config,
            version: existing.content.version,
        },
        metadata: existing.metadata,
    }

    const body = JSON.stringify(updatedCard)

    const response = await authFetch(`/content`, {
        method: "POST",
        body,
    })

    const data = (await response.json()) as {card: YotoCard}
    return data.card
}

// Get upload URL for audio file (GET /media/transcode/audio/uploadUrl)
const getUploadUrl = async (
    sha256: string,
    filename: string,
): Promise<{uploadUrl: string; uploadId: string}> => {
    const params = new URLSearchParams({sha256, filename})
    const response = await authFetch(
        `/media/transcode/audio/uploadUrl?${params}`,
    )
    const data = (await response.json()) as UploadUrlResponse

    if (!data.upload?.uploadUrl) {
        throw new Error(
            `Yoto API did not return upload URL. Response: ${JSON.stringify(data)}`,
        )
    }

    return {
        uploadUrl: data.upload.uploadUrl,
        uploadId: data.upload.uploadId,
    }
}

// Check transcode status (GET /media/upload/{sha256}/transcoded)
const checkTranscodeStatus = async (
    sha256: string,
): Promise<TranscodeStatusResponse> => {
    const response = await authFetch(
        `/media/upload/${sha256}/transcoded?loudnorm=false`,
    )
    return (await response.json()) as TranscodeStatusResponse
}

// Calculate SHA256 hash of a file
const calculateFileSha256 = (filePath: string): string => {
    const content = readFileSync(filePath)
    return createHash("sha256").update(content).digest("hex")
}

// Upload audio file and wait for transcode
const uploadAudio = async (
    filePath: string,
    onProgress?: (status: string) => void,
): Promise<{key: string; duration: number; fileSize: number}> => {
    const sha256 = calculateFileSha256(filePath)
    const filename = basename(filePath)

    // Check if already transcoded (file was previously uploaded)
    try {
        const existingStatus = await checkTranscodeStatus(sha256)
        const transcode = existingStatus.transcode
        if (transcode?.progress?.phase === "complete" && transcode.transcodedSha256) {
            onProgress?.("File already uploaded")
            return {
                key: transcode.transcodedSha256,
                duration: transcode.transcodedInfo?.duration ?? 0,
                fileSize: transcode.transcodedInfo?.fileSize ?? 0,
            }
        }
    } catch {
        // File doesn't exist yet, continue with upload
    }

    onProgress?.("Getting upload URL...")

    // Get upload URL
    const {uploadUrl} = await getUploadUrl(sha256, filename)

    onProgress?.("Uploading...")

    // Upload file to S3
    const fileContent = readFileSync(filePath)
    const fileStats = statSync(filePath)

    const uploadResponse = await fetch(uploadUrl, {
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

    onProgress?.("Processing...")

    // Poll for transcode completion
    const maxAttempts = 60 // 5 minutes max
    const pollInterval = 5000 // 5 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))

        const status = await checkTranscodeStatus(sha256)
        const transcode = status.transcode

        if (transcode?.progress?.phase === "complete" && transcode.transcodedSha256) {
            return {
                key: transcode.transcodedSha256,
                duration: transcode.transcodedInfo?.duration ?? 0,
                fileSize: transcode.transcodedInfo?.fileSize ?? 0,
            }
        }

        if (transcode?.progress?.phase === "failed") {
            throw new Error("Audio transcode failed")
        }

        onProgress?.(`Processing... (${attempt + 1}/${maxAttempts})`)
    }

    throw new Error("Audio transcode timed out")
}

// Create a chapter from an uploaded audio file
const createChapter = (
    title: string,
    transcodedSha256: string,
    position: number,
    duration?: number,
    fileSize?: number,
): YotoChapter => {
    // Chapter key is just the position as a string (0-indexed internally)
    const chapterKey = String(position - 1).padStart(2, "0")

    // Note: Icons must be in "yoto:#<43-char-mediaId>" format
    // For now, we omit custom icons and let Yoto use defaults
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

export {
    checkTranscodeStatus,
    createChapter,
    createPlaylist,
    getPlaylist,
    getUploadUrl,
    listPlaylists,
    updatePlaylist,
    uploadAudio,
}

export type {
    TranscodeStatusResponse,
    UploadUrlResponse,
    YotoCard,
    YotoChapter,
    YotoContent,
    YotoMetadata,
    YotoPlaylistSummary,
    YotoTrack,
}
