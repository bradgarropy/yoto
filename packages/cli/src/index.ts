#!/usr/bin/env node

import {
    completeLogin,
    getYotoSdk,
    initiateLogin,
    logout,
    status,
} from "@yoto/core/auth"
import {isUrl} from "@yoto/core/url"
import {program} from "commander"

import {sync} from "~/yoto/sync"
import {downloadPlaylist, downloadVideo, isInstalled} from "~/ytdlp"

type Options = {
    directory?: string
}

type ParsedInput = {
    type: "video" | "playlist"
    url: string
}

const parseInput = (input: string): ParsedInput => {
    // Full YouTube URL
    if (isUrl(input)) {
        // Check if it's a playlist URL
        if (input.includes("playlist?list=") || input.includes("&list=PL")) {
            return {type: "playlist", url: input}
        }
        // Otherwise treat as video URL
        return {type: "video", url: input}
    }

    // Playlist ID (starts with PL)
    if (input.startsWith("PL")) {
        return {
            type: "playlist",
            url: `https://www.youtube.com/playlist?list=${input}`,
        }
    }

    // Video ID (typically 11 characters)
    return {
        type: "video",
        url: `https://www.youtube.com/watch?v=${input}`,
    }
}

program
    .name("yoto")
    .description("Sync YouTube playlists to Yoto")
    .version("1.0.0")

// Login command
program
    .command("login")
    .description("Authenticate with Yoto using Device Code Flow")
    .action(async () => {
        try {
            console.log("Starting authentication...\n")

            const result = await initiateLogin()

            if (!result.success) {
                console.error(`Error: ${result.error}`)
                process.exit(1)
            }

            console.log(`Go to: ${result.verificationUri}`)
            console.log(`Enter code: ${result.userCode}\n`)
            console.log("Waiting for authentication...")

            const completion = await completeLogin(
                result.deviceCode!,
                result.interval!,
            )

            if (completion.success) {
                console.log(
                    `\nLogged in successfully! Token expires in ${completion.expiresIn}.`,
                )
            } else {
                console.error(`\nError: ${completion.error}`)
                process.exit(1)
            }
        } catch (error) {
            console.error(
                `\nError: ${error instanceof Error ? error.message : error}`,
            )
            process.exit(1)
        }
    })

// Logout command
program
    .command("logout")
    .description("Clear stored authentication token")
    .action(async () => {
        await logout()
        console.log("Logged out. Token cleared.")
    })

// Status command
program
    .command("status")
    .description("Show login status and token expiry")
    .action(async () => {
        const result = await status()

        if (result.valid) {
            console.log("Logged in")
            console.log(`  Token expires in ${result.expiresIn}`)
        } else if (result.reason === "expired") {
            console.log("Token expired")
            console.log("  Run: yoto login")
        } else {
            console.log("Not logged in")
            console.log("  Run: yoto login")
        }
    })

// List command
program
    .command("list")
    .description("Show all Yoto playlists")
    .action(async () => {
        try {
            const sdk = await getYotoSdk()
            const cards = await sdk.content.getMyCards()

            if (cards.length === 0) {
                console.log("No playlists found")
                return
            }

            // Calculate column widths
            const idWidth = Math.max(
                "ID".length,
                ...cards.map(c => c.cardId.length),
            )

            const nameWidth = Math.max(
                "Name".length,
                ...cards.map(c => c.title.length),
            )

            // Print header
            console.log()
            console.log(`${"ID".padEnd(idWidth)}  ${"Name".padEnd(nameWidth)}`)
            console.log(`${"─".repeat(idWidth)}  ${"─".repeat(nameWidth)}`)

            // Print playlists
            for (const card of cards) {
                console.log(`${card.cardId.padEnd(idWidth)}  ${card.title}`)
            }

            console.log()
            console.log(
                `${cards.length} playlist${cards.length === 1 ? "" : "s"}`,
            )
        } catch (error) {
            console.error(
                `Error: ${error instanceof Error ? error.message : error}`,
            )

            process.exit(1)
        }
    })

// Inspect command (debug)
program
    .command("inspect <cardId>")
    .description("Inspect a Yoto playlist (debug)")
    .action(async (cardId: string) => {
        try {
            const sdk = await getYotoSdk()
            const card = await sdk.content.getCard(cardId)
            console.log(JSON.stringify(card, null, 2))
        } catch (error) {
            console.error(
                `Error: ${error instanceof Error ? error.message : error}`,
            )
            process.exit(1)
        }
    })

// Sync command
program
    .command("sync <url>")
    .description("Sync YouTube playlist to Yoto")
    .option("-p, --playlist <name>", "Fuzzy match Yoto playlist by name")
    .action(async (url: string, options: {playlist?: string}) => {
        const isYtDlpInstalled = await isInstalled()

        if (!isYtDlpInstalled) {
            console.error("Error: yt-dlp is not installed")
            console.error("\nInstall it with:")
            console.error("  brew install yt-dlp ffmpeg")
            process.exit(1)
        }

        try {
            await sync(url, {playlistName: options.playlist})
        } catch (error) {
            if (error instanceof Error && error.message === "Sync cancelled") {
                process.exit(0)
            }
            console.error(
                `\nError: ${error instanceof Error ? error.message : error}`,
            )
            process.exit(1)
        }
    })

// Download command (legacy functionality)
program
    .command("download <input>")
    .description("Download YouTube video or playlist as audio files")
    .option("-d, --directory <dir>", "Output directory (defaults to ~/Desktop)")
    .action(async (input: string, options: Options) => {
        const isYtDlpInstalled = await isInstalled()

        if (!isYtDlpInstalled) {
            console.error("Error: yt-dlp is not installed")
            console.error("\nInstall it with:")
            console.error("  brew install yt-dlp ffmpeg")
            process.exit(1)
        }

        try {
            const {type, url} = parseInput(input)

            if (type === "playlist") {
                console.log("Detected: playlist")
                await downloadPlaylist(url, options)
                process.exit(0)
            }

            if (type === "video") {
                console.log("Detected: video")
                await downloadVideo(url, options)
                process.exit(0)
            }
        } catch (error) {
            console.error(
                `\nError: ${error instanceof Error ? error.message : error}`,
            )
            process.exit(1)
        }
    })

program.parse()

export type {Options}
