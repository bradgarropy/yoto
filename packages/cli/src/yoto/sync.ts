import {spawn} from "node:child_process"
import {createHash} from "node:crypto"
import {existsSync, readFileSync, rmSync, statSync} from "node:fs"
import {mkdir} from "node:fs/promises"
import {homedir} from "node:os"
import {basename, join} from "node:path"

import {confirm, input, select} from "@inquirer/prompts"
import {getYotoSdk} from "@yoto/core/auth"
import {
    getPlaylistAssociation,
    setPlaylistAssociation,
} from "@yoto/core/playlists"
import type {YouTubePlaylistInfo, YouTubeTrack} from "@yoto/core/youtube"
import {
    downloadTrack,
    extractPlaylistId,
    getPlaylistInfo,
} from "@yoto/core/youtube"
import type {UserCard, YotoJson} from "@yotoplay/yoto-sdk"
import Fuse from "fuse.js"

// Yoto card content types (SDK uses generic YotoJson)
type YotoTrack = {
    key: string
    title: string
    format: string
    trackUrl: string
    type: string
    duration?: number
    fileSize?: number
    channels?: string
}

type YotoChapter = {
    key: string
    title: string
    tracks: YotoTrack[]
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

type YotoCard = YotoJson & {
    cardId?: string
    title?: string
    content: YotoContent
    metadata: YotoMetadata
}

type SyncAction = "keep" | "add" | "remove"

type SyncPlanItem = {
    position: number
    action: SyncAction
    title: string
    youtubeTrack?: YouTubeTrack
    yotoChapter?: YotoChapter
}

type SyncPlan = {
    items: SyncPlanItem[]
    toKeep: number
    toAdd: number
    toRemove: number
}

type SyncOptions = {
    playlistName?: string
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

// Calculate SHA256 hash of a file
const calculateFileSha256 = (filePath: string): string => {
    const content = readFileSync(filePath)
    return createHash("sha256").update(content).digest("hex")
}

// Upload audio file and wait for transcode using SDK
const uploadAudio = async (
    filePath: string,
    onProgress?: (status: string) => void,
): Promise<{key: string; duration: number; fileSize: number}> => {
    const sdk = await getYotoSdk()
    const sha256 = calculateFileSha256(filePath)
    const filename = basename(filePath)

    // Type for the actual API response (differs from SDK types)
    type TranscodeResult = {
        progress?: {phase: string}
        transcodedSha256?: string
        transcodedInfo?: {duration: number; fileSize: number}
    }

    // Check if already transcoded (file was previously uploaded)
    try {
        const existingStatus = (await sdk.media.getTranscodedUpload(
            sha256,
            false,
        )) as unknown as TranscodeResult

        if (
            existingStatus?.progress?.phase === "complete" &&
            existingStatus.transcodedSha256
        ) {
            onProgress?.("File already uploaded")
            return {
                key: existingStatus.transcodedSha256,
                duration: existingStatus.transcodedInfo?.duration ?? 0,
                fileSize: existingStatus.transcodedInfo?.fileSize ?? 0,
            }
        }
    } catch {
        // File doesn't exist yet, continue with upload
    }

    onProgress?.("Getting upload URL...")

    // Get upload URL - SDK types say 'url' but API returns 'uploadUrl'
    const uploadInfo = (await sdk.media.getUploadUrlForTranscode(
        sha256,
        filename,
    )) as unknown as {uploadId: string; uploadUrl: string | null}

    // If uploadUrl is null, the file was already uploaded - skip to polling
    if (uploadInfo.uploadUrl) {
        onProgress?.("Uploading...")

        // Upload file to S3 using direct fetch (more reliable than SDK's axios-based upload)
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
    } else {
        onProgress?.("Already uploaded, processing...")
    }

    onProgress?.("Processing...")

    // Poll for transcode completion
    const maxAttempts = 60 // 5 minutes max
    const pollInterval = 5000 // 5 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))

        try {
            const transcodeStatus = (await sdk.media.getTranscodedUpload(
                sha256,
                false,
            )) as unknown as TranscodeResult

            // Check for completion
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

        onProgress?.(`Processing... (${attempt + 1}/${maxAttempts})`)
    }

    throw new Error("Audio transcode timed out")
}

// Fuzzy match track titles
const fuzzyMatchTrack = (
    youtubeTitle: string,
    yotoChapters: YotoChapter[],
): YotoChapter | null => {
    if (yotoChapters.length === 0) {
        return null
    }

    const fuse = new Fuse(yotoChapters, {
        keys: ["title"],
        threshold: 0.4, // Lower = stricter matching
        includeScore: true,
    })

    const results = fuse.search(youtubeTitle)

    if (results.length > 0 && results[0].score !== undefined) {
        // Only accept matches with good confidence
        if (results[0].score < 0.4) {
            return results[0].item
        }
    }

    return null
}

// Fuzzy match playlist by name
const fuzzyMatchPlaylist = (
    name: string,
    playlists: UserCard[],
): UserCard[] => {
    const fuse = new Fuse(playlists, {
        keys: ["title"],
        threshold: 0.4,
        includeScore: true,
    })

    const results = fuse.search(name)
    return results.map(r => r.item)
}

// Generate sync plan
const generateSyncPlan = (
    youtubeTracks: YouTubeTrack[],
    yotoChapters: YotoChapter[],
): SyncPlan => {
    const items: SyncPlanItem[] = []
    const matchedYotoChapters = new Set<string>()

    // Process YouTube tracks in order
    for (let i = 0; i < youtubeTracks.length; i++) {
        const ytTrack = youtubeTracks[i]
        const matchedChapter = fuzzyMatchTrack(ytTrack.title, yotoChapters)

        if (matchedChapter && !matchedYotoChapters.has(matchedChapter.key)) {
            // Keep existing track
            matchedYotoChapters.add(matchedChapter.key)
            items.push({
                position: i + 1,
                action: "keep",
                title: ytTrack.title,
                youtubeTrack: ytTrack,
                yotoChapter: matchedChapter,
            })
        } else {
            // Add new track
            items.push({
                position: i + 1,
                action: "add",
                title: ytTrack.title,
                youtubeTrack: ytTrack,
            })
        }
    }

    // Find tracks to remove (in Yoto but not matched)
    for (const chapter of yotoChapters) {
        if (!matchedYotoChapters.has(chapter.key)) {
            items.push({
                position: -1,
                action: "remove",
                title: chapter.title,
                yotoChapter: chapter,
            })
        }
    }

    return {
        items,
        toKeep: items.filter(i => i.action === "keep").length,
        toAdd: items.filter(i => i.action === "add").length,
        toRemove: items.filter(i => i.action === "remove").length,
    }
}

// Print sync plan
const printSyncPlan = (plan: SyncPlan): void => {
    console.log("\nSync plan:\n")
    console.log("  #   Status   Track")
    console.log("  " + "─".repeat(50))

    // Print items in order (keeps and adds first, then removes)
    const sortedItems = [
        ...plan.items.filter(i => i.action !== "remove"),
        ...plan.items.filter(i => i.action === "remove"),
    ]

    for (const item of sortedItems) {
        const posStr =
            item.position > 0 ? item.position.toString().padStart(2) : " -"
        const statusColor =
            item.action === "keep" ? "=" : item.action === "add" ? "+" : "-"

        console.log(`  ${posStr}   ${statusColor}        ${item.title}`)
    }

    console.log()
    console.log(
        `  Summary: ${plan.toKeep} keep, ${plan.toAdd} add, ${plan.toRemove} remove`,
    )
    console.log()
}

// Create a new playlist using SDK
const createPlaylist = async (
    title: string,
    chapters: YotoChapter[] = [],
): Promise<{cardId: string; title: string}> => {
    const sdk = await getYotoSdk()

    const cardData: YotoCard = {
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
    }

    // Add title to the card data
    const cardWithTitle = {...cardData, title} as YotoJson

    const result = await sdk.content.updateCard(cardWithTitle)
    const resultCard = result as YotoCard

    return {
        cardId: resultCard.cardId ?? "",
        title: resultCard.title ?? title,
    }
}

// Update an existing playlist using SDK
const updatePlaylist = async (
    cardId: string,
    updates: {
        title?: string
        chapters?: YotoChapter[]
    },
): Promise<void> => {
    const sdk = await getYotoSdk()

    // Fetch existing card
    const existing = (await sdk.content.getCard(cardId)) as YotoCard

    // Build updated card
    const updatedCard: YotoCard = {
        ...existing,
        cardId,
        title: updates.title ?? existing.title,
        content: {
            ...existing.content,
            chapters: updates.chapters ?? existing.content.chapters,
        },
        metadata: existing.metadata,
    }

    await sdk.content.updateCard(updatedCard as YotoJson)
}

// Resolve target Yoto playlist
const resolveYotoPlaylist = async (
    youtubePlaylistId: string,
    youtubePlaylistTitle: string,
    options: SyncOptions,
): Promise<{cardId: string; title: string; isNew: boolean}> => {
    const sdk = await getYotoSdk()
    const yotoPlaylists = await sdk.content.getMyCards()

    // 1. If --playlist flag provided, fuzzy match
    if (options.playlistName) {
        const matches = fuzzyMatchPlaylist(options.playlistName, yotoPlaylists)

        if (matches.length === 0) {
            // No matches, create new playlist
            const shouldCreate = await confirm({
                message: `No Yoto playlist matches "${options.playlistName}". Create new playlist?`,
                default: true,
            })

            if (!shouldCreate) {
                throw new Error("Sync cancelled")
            }

            const newTitle = await input({
                message: "Enter playlist name:",
                default: youtubePlaylistTitle,
            })

            const newPlaylist = await createPlaylist(newTitle)
            return {
                cardId: newPlaylist.cardId,
                title: newPlaylist.title,
                isNew: true,
            }
        }

        if (matches.length === 1) {
            return {
                cardId: matches[0].cardId,
                title: matches[0].title,
                isNew: false,
            }
        }

        // Multiple matches, prompt selection
        const selected = await select({
            message: `Multiple Yoto playlists match "${options.playlistName}":`,
            choices: matches.map(p => ({
                name: `${p.title} (${p.cardId})`,
                value: p,
            })),
        })

        return {cardId: selected.cardId, title: selected.title, isNew: false}
    }

    // 2. Check for saved association
    const association = getPlaylistAssociation(youtubePlaylistId)

    if (association) {
        console.log(
            `Found linked Yoto playlist: "${association.yotoName}" (${association.yotoId})`,
        )

        const useExisting = await confirm({
            message: "Use this playlist?",
            default: true,
        })

        if (useExisting) {
            return {
                cardId: association.yotoId,
                title: association.yotoName,
                isNew: false,
            }
        }
    }

    // 3. No association or user declined, prompt for selection or creation
    const action = await select({
        message: "Select a Yoto playlist or create new:",
        choices: [
            {name: "Create new playlist", value: "new"},
            ...yotoPlaylists.map(p => ({
                name: `${p.title} (${p.cardId})`,
                value: p.cardId,
            })),
        ],
    })

    if (action === "new") {
        const newTitle = await input({
            message: "Enter playlist name:",
            default: youtubePlaylistTitle,
        })

        const newPlaylist = await createPlaylist(newTitle)
        return {
            cardId: newPlaylist.cardId,
            title: newPlaylist.title,
            isNew: true,
        }
    }

    const selected = yotoPlaylists.find(p => p.cardId === action)!
    return {cardId: selected.cardId, title: selected.title, isNew: false}
}

// Main sync function
const sync = async (url: string, options: SyncOptions = {}): Promise<void> => {
    const sdk = await getYotoSdk()

    // Create temp directory for downloads (on Desktop for easy debugging)
    const tempDir = join(homedir(), "Desktop", "yoto-temp")
    await mkdir(tempDir, {recursive: true})

    try {
        // 1. Fetch YouTube playlist info
        console.log("Fetching YouTube playlist...")
        const youtubeInfo = await getPlaylistInfo(url)
        const youtubePlaylistId = extractPlaylistId(url)

        console.log(
            `Found: "${youtubeInfo.title}" (${youtubeInfo.tracks.length} songs)`,
        )
        console.log()

        // 2. Resolve target Yoto playlist
        const yotoTarget = await resolveYotoPlaylist(
            youtubePlaylistId,
            youtubeInfo.title,
            options,
        )

        // 3. Get current Yoto playlist tracks
        console.log("Fetching current tracks...")
        const yotoPlaylist = (await sdk.content.getCard(
            yotoTarget.cardId,
        )) as YotoCard
        const currentChapters = yotoPlaylist.content?.chapters || []

        // 4. Generate and display sync plan
        const plan = generateSyncPlan(youtubeInfo.tracks, currentChapters)
        printSyncPlan(plan)

        // 5. Confirm sync
        if (plan.toAdd === 0 && plan.toRemove === 0) {
            console.log("Playlist is already in sync!")
            return
        }

        const shouldContinue = await confirm({
            message: "Continue with sync?",
            default: true,
        })

        if (!shouldContinue) {
            console.log("Sync cancelled")
            return
        }

        // 6. Download new songs
        const tracksToAdd = plan.items.filter(i => i.action === "add")

        if (tracksToAdd.length > 0) {
            console.log("\nDownloading new songs...")

            const downloadedTracks: Map<string, string> = new Map()

            for (let i = 0; i < tracksToAdd.length; i++) {
                const item = tracksToAdd[i]
                const track = item.youtubeTrack!

                process.stdout.write(
                    `[${i + 1}/${tracksToAdd.length}] ${track.title}...`,
                )

                try {
                    const filePath = await downloadTrack(track, tempDir)
                    downloadedTracks.set(track.id, filePath)
                    console.log(" done")
                } catch (error) {
                    console.log(" FAILED")
                    throw error
                }
            }

            // 7. Upload to Yoto
            console.log("\nUploading to Yoto...")

            const uploadedTracks: Map<
                string,
                {key: string; duration: number; fileSize: number}
            > = new Map()

            for (let i = 0; i < tracksToAdd.length; i++) {
                const item = tracksToAdd[i]
                const track = item.youtubeTrack!
                const filePath = downloadedTracks.get(track.id)!

                process.stdout.write(
                    `[${i + 1}/${tracksToAdd.length}] ${track.title}...`,
                )

                try {
                    const result = await uploadAudio(filePath)
                    uploadedTracks.set(track.id, result)
                    console.log(" done")
                } catch (error) {
                    console.log(" FAILED")
                    throw error
                }
            }

            // 8. Build new chapters array
            const newChapters: YotoChapter[] = []

            for (const item of plan.items.filter(i => i.action !== "remove")) {
                if (item.action === "keep" && item.yotoChapter) {
                    // Keep existing chapter with its icon
                    newChapters.push(item.yotoChapter)
                } else if (item.action === "add" && item.youtubeTrack) {
                    // Create new chapter
                    const uploaded = uploadedTracks.get(item.youtubeTrack.id)!
                    const chapter = createChapter(
                        item.youtubeTrack.title,
                        uploaded.key,
                        item.position,
                        uploaded.duration,
                        uploaded.fileSize,
                    )
                    newChapters.push(chapter)
                }
            }

            // 9. Update playlist
            console.log("\nUpdating playlist...")
            await updatePlaylist(yotoTarget.cardId, {chapters: newChapters})
        } else if (plan.toRemove > 0) {
            // Only removals, no additions
            const newChapters = plan.items
                .filter(i => i.action === "keep" && i.yotoChapter)
                .map(i => i.yotoChapter!)

            console.log("\nUpdating playlist...")
            await updatePlaylist(yotoTarget.cardId, {chapters: newChapters})
        }

        // 10. Save association
        setPlaylistAssociation(youtubePlaylistId, {
            yotoId: yotoTarget.cardId,
            yotoName: yotoTarget.title,
            youtubeName: youtubeInfo.title,
            lastSynced: new Date().toISOString(),
        })

        console.log("Playlist updated!")
        console.log(
            `  Opening https://my.yotoplay.com/card/${yotoTarget.cardId}/edit`,
        )

        // Open in browser (macOS)
        spawn(
            "open",
            [`https://my.yotoplay.com/card/${yotoTarget.cardId}/edit`],
            {
                detached: true,
                stdio: "ignore",
            },
        ).unref()
    } finally {
        // Clean up temp directory
        if (existsSync(tempDir)) {
            rmSync(tempDir, {recursive: true, force: true})
        }
    }
}

export {sync}
export type {
    SyncOptions,
    SyncPlan,
    SyncPlanItem,
    YouTubePlaylistInfo,
    YouTubeTrack,
}
