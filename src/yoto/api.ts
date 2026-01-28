import {createHash} from "node:crypto"
import {readFileSync, statSync} from "node:fs"
import {basename} from "node:path"
import {requireAuth} from "~/yoto/auth"

const BASE_URL = "https://api.yotoplay.com"

// Types for Yoto API responses
type YotoChapter = {
    title: string
    key: string
    duration?: number
    icon?: string
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
    uploadUrl: string
    key: string
}

type TranscodeStatusResponse = {
    status: "pending" | "processing" | "completed" | "failed"
    key?: string
    duration?: number
}

// Helper for authenticated requests
const authFetch = async (
    path: string,
    options: RequestInit = {},
): Promise<Response> => {
    const token = requireAuth()

    const response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...options.headers,
        },
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

// Update an existing playlist (PUT /content/{cardId})
const updatePlaylist = async (
    cardId: string,
    updates: {
        title?: string
        chapters?: YotoChapter[]
    },
): Promise<YotoCard> => {
    // First fetch the existing playlist to preserve other fields
    const existing = await getPlaylist(cardId)

    const updatedCard = {
        ...existing,
        title: updates.title ?? existing.title,
        content: {
            ...existing.content,
            chapters: updates.chapters ?? existing.content.chapters,
        },
    }

    const response = await authFetch(`/content/${cardId}`, {
        method: "PUT",
        body: JSON.stringify(updatedCard),
    })

    const data = (await response.json()) as {card: YotoCard}
    return data.card
}

// Get upload URL for audio file (GET /media/transcode/audio/uploadUrl)
const getUploadUrl = async (
    sha256: string,
    filename: string,
): Promise<UploadUrlResponse> => {
    const params = new URLSearchParams({sha256, filename})
    const response = await authFetch(
        `/media/transcode/audio/uploadUrl?${params}`,
    )
    return (await response.json()) as UploadUrlResponse
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
): Promise<{key: string; duration: number}> => {
    const sha256 = calculateFileSha256(filePath)
    const filename = basename(filePath)

    onProgress?.("Getting upload URL...")

    // Get upload URL
    const {uploadUrl, key} = await getUploadUrl(sha256, filename)

    // Check if already transcoded (file was previously uploaded)
    try {
        const existingStatus = await checkTranscodeStatus(sha256)
        if (existingStatus.status === "completed" && existingStatus.key) {
            onProgress?.("File already uploaded")
            return {
                key: existingStatus.key,
                duration: existingStatus.duration ?? 0,
            }
        }
    } catch {
        // File doesn't exist yet, continue with upload
    }

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

        if (status.status === "completed" && status.key) {
            return {key: status.key, duration: status.duration ?? 0}
        }

        if (status.status === "failed") {
            throw new Error("Audio transcode failed")
        }

        onProgress?.(`Processing... (${attempt + 1}/${maxAttempts})`)
    }

    throw new Error("Audio transcode timed out")
}

// Create a chapter from an uploaded audio file
const createChapter = (
    title: string,
    key: string,
    position: number,
    duration?: number,
): YotoChapter => {
    // Use number icons for new tracks (1-20 available)
    const iconNumber = Math.min(position, 20)
    const icon = `https://cdn.yoto.io/preset-icon/number_${iconNumber}.gif`

    return {
        title,
        key,
        duration,
        icon,
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
}
