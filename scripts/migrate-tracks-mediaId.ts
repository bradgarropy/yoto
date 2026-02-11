/**
 * Migration script to backfill mediaId for existing synced tracks.
 *
 * Run with: npx tsx scripts/migrate-tracks-mediaId.ts
 *
 * This script:
 * 1. Reads tracks.json
 * 2. For each card, fetches chapter data from the Yoto API
 * 3. Matches synced tracks to chapters by title
 * 4. Extracts mediaId from each chapter's trackUrl
 * 5. Updates tracks.json with the mediaId values
 */

import {copyFileSync, existsSync, readFileSync, writeFileSync} from "node:fs"
import {homedir} from "node:os"
import {join} from "node:path"

import {DeviceCodeAuth, TokenManager} from "@yotoplay/oauth-device-code-flow"
import {createYotoSdk, type YotoSdk} from "@yotoplay/yoto-sdk"

// Config paths (same as app/lib/paths.server.ts)
const CONFIG_PATH = join(homedir(), ".config", "yoto")
const TRACKS_FILE = join(CONFIG_PATH, "tracks.json")
const TOKEN_PATH = join(CONFIG_PATH, "auth.json")

// Auth config (same as app/lib/auth.server.ts)
const AUTH_CONFIG = {
    domain: "login.yotoplay.com",
    clientId: "PhKouPhz6NPVaWLtyeiEwjfB7m8sVR77",
    audience: "https://api.yotoplay.com",
}

// Types
type SyncedTrack = {
    youtubeVideoId: string
    title: string
    syncedAt: string
    yotoTrackKey: string
    mediaId?: string // Optional for migration
}

type CardTracks = {
    videos: SyncedTrack[]
    youtubePlaylistId?: string
    lastSynced: string
}

type Tracks = Record<string, CardTracks>

type YotoTrack = {
    key: string
    title: string
    trackUrl: string
}

type YotoChapter = {
    key: string
    title: string
    tracks: YotoTrack[]
}

type YotoCard = {
    cardId: string
    title?: string
    content?: {
        chapters?: YotoChapter[]
    }
}

// Get authenticated SDK
async function getAuthenticatedSdk(): Promise<YotoSdk> {
    const tokenManager = new TokenManager(TOKEN_PATH)
    const tokens = await tokenManager.loadTokens()

    if (!tokens) {
        throw new Error("Not logged in. Please run the app and log in first.")
    }

    // Check if token needs refresh
    if (tokenManager.isTokenExpired(tokens)) {
        if (!tokens.refreshToken) {
            throw new Error(
                "Token expired and no refresh token. Please log in again.",
            )
        }

        const auth = new DeviceCodeAuth(AUTH_CONFIG)
        const result = await auth.refreshToken(tokens.refreshToken)

        if (!result.success || !result.tokens) {
            throw new Error("Failed to refresh token. Please log in again.")
        }

        await tokenManager.saveTokens(result.tokens)
        return createYotoSdk({jwt: result.tokens.accessToken})
    }

    return createYotoSdk({jwt: tokens.accessToken})
}

// Extract mediaId from trackUrl (format: "yoto:#<hash>")
function extractMediaId(trackUrl: string): string | null {
    if (!trackUrl.startsWith("yoto:#")) {
        return null
    }
    return trackUrl.slice(6) // Remove "yoto:#" prefix
}

// Main migration function
async function migrate(): Promise<void> {
    console.log("Starting mediaId migration...\n")

    // Check if tracks file exists
    if (!existsSync(TRACKS_FILE)) {
        console.log("No tracks.json found. Nothing to migrate.")
        return
    }

    // Read tracks
    const content = readFileSync(TRACKS_FILE, "utf-8")
    let tracks: Tracks

    try {
        tracks = JSON.parse(content) as Tracks
    } catch {
        throw new Error("Failed to parse tracks.json")
    }

    const cardIds = Object.keys(tracks)

    if (cardIds.length === 0) {
        console.log("No cards found in tracks.json. Nothing to migrate.")
        return
    }

    console.log(`Found ${cardIds.length} card(s) to process.\n`)

    // Create backup
    const backupPath = `${TRACKS_FILE}.backup-${Date.now()}`
    copyFileSync(TRACKS_FILE, backupPath)
    console.log(`Created backup: ${backupPath}\n`)

    // Get authenticated SDK
    const sdk = await getAuthenticatedSdk()

    let totalUpdated = 0
    let totalSkipped = 0
    let totalUnmatched = 0

    // Process each card
    for (const cardId of cardIds) {
        const cardTracks = tracks[cardId]
        console.log(`Processing card: ${cardId}`)

        // Skip if no videos
        if (!cardTracks.videos || cardTracks.videos.length === 0) {
            console.log("  No videos to process, skipping.\n")
            continue
        }

        // Check if all videos already have mediaId
        const needsMigration = cardTracks.videos.some(v => !v.mediaId)
        if (!needsMigration) {
            console.log("  All videos already have mediaId, skipping.\n")
            totalSkipped += cardTracks.videos.length
            continue
        }

        // Fetch card from Yoto API
        let card: YotoCard
        try {
            card = (await sdk.content.getCard(cardId)) as unknown as YotoCard
        } catch (error) {
            console.log(
                `  Failed to fetch card from API: ${error instanceof Error ? error.message : "Unknown error"}`,
            )
            console.log("  Skipping this card.\n")
            totalUnmatched += cardTracks.videos.filter(v => !v.mediaId).length
            continue
        }

        const chapters = card.content?.chapters ?? []

        if (chapters.length === 0) {
            console.log("  No chapters found in card, skipping.\n")
            totalUnmatched += cardTracks.videos.filter(v => !v.mediaId).length
            continue
        }

        // Build title -> chapter map for matching
        // Note: This is the one-time use of title matching for migration
        const titleToChapter = new Map<string, YotoChapter>()
        for (const chapter of chapters) {
            if (chapter.title && !titleToChapter.has(chapter.title)) {
                titleToChapter.set(chapter.title, chapter)
            }
        }

        // Update each video
        for (const video of cardTracks.videos) {
            if (video.mediaId) {
                console.log(`  "${video.title}" - already has mediaId`)
                totalSkipped++
                continue
            }

            const chapter = titleToChapter.get(video.title)

            if (!chapter) {
                console.log(
                    `  "${video.title}" - no matching chapter found (title may have changed)`,
                )
                totalUnmatched++
                continue
            }

            const trackUrl = chapter.tracks?.[0]?.trackUrl
            if (!trackUrl) {
                console.log(`  "${video.title}" - chapter has no trackUrl`)
                totalUnmatched++
                continue
            }

            const mediaId = extractMediaId(trackUrl)
            if (!mediaId) {
                console.log(
                    `  "${video.title}" - invalid trackUrl format: ${trackUrl}`,
                )
                totalUnmatched++
                continue
            }

            video.mediaId = mediaId
            console.log(
                `  "${video.title}" - updated with mediaId: ${mediaId.slice(0, 16)}...`,
            )
            totalUpdated++
        }

        console.log()
    }

    // Write updated tracks
    writeFileSync(TRACKS_FILE, JSON.stringify(tracks, null, 4))

    // Summary
    console.log("Migration complete!")
    console.log(`  Updated: ${totalUpdated}`)
    console.log(`  Skipped (already had mediaId): ${totalSkipped}`)
    console.log(`  Unmatched (manual fix needed): ${totalUnmatched}`)

    if (totalUnmatched > 0) {
        console.log(
            "\nNote: Unmatched tracks may need manual attention. This can happen if:",
        )
        console.log("  - The track title was changed in Yoto after syncing")
        console.log("  - The track was deleted from the card")
        console.log(
            "  - Multiple tracks had the same title (only first matched)",
        )
    }
}

// Run migration
migrate().catch(error => {
    console.error("Migration failed:", error.message)
    process.exit(1)
})
