#!/usr/bin/env node

import {createInterface} from "node:readline"
import {program} from "commander"
import {isUrl} from "~/url"
import {getPlaylist, listPlaylists} from "~/yoto/api"
import {login, logout, status} from "~/yoto/auth"
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

const prompt = (question: string): Promise<string> => {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close()
            resolve(answer)
        })
    })
}

program
    .name("yoto")
    .description("Sync YouTube playlists to Yoto")
    .version("1.0.0")

// Login command
program
    .command("login")
    .description("Authenticate with Yoto using a bearer token")
    .action(async () => {
        console.log("\nTo authenticate with Yoto:\n")
        console.log("1. Open https://my.yotoplay.com in your browser")
        console.log("2. Log in if needed")
        console.log("3. Open DevTools (F12) → Network tab")
        console.log("4. Refresh the page")
        console.log("5. Click any request to api.yotoplay.com")
        console.log(
            '6. Copy the "authorization" header value (starts with "Bearer ey...")\n',
        )

        const token = await prompt("Paste your token: ")

        if (!token.trim()) {
            console.error("\nError: No token provided")
            process.exit(1)
        }

        try {
            const result = login(token)
            console.log(
                `\nLogged in successfully! Token expires in ${result.expiresIn}.`,
            )
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
    .action(() => {
        logout()
        console.log("Logged out. Token cleared.")
    })

// Status command
program
    .command("status")
    .description("Show login status and token expiry")
    .action(() => {
        const result = status()

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
            const playlists = await listPlaylists()

            if (playlists.length === 0) {
                console.log("No playlists found")
                return
            }

            // Calculate column widths
            const idWidth = Math.max(
                "ID".length,
                ...playlists.map(p => p.cardId.length),
            )

            const nameWidth = Math.max(
                "Name".length,
                ...playlists.map(p => p.title.length),
            )

            // Print header
            console.log()
            console.log(`${"ID".padEnd(idWidth)}  ${"Name".padEnd(nameWidth)}`)
            console.log(`${"─".repeat(idWidth)}  ${"─".repeat(nameWidth)}`)

            // Print playlists
            for (const playlist of playlists) {
                console.log(
                    `${playlist.cardId.padEnd(idWidth)}  ${playlist.title}`,
                )
            }

            console.log()
            console.log(
                `${playlists.length} playlist${playlists.length === 1 ? "" : "s"}`,
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
            const playlist = await getPlaylist(cardId)
            console.log(JSON.stringify(playlist, null, 2))
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
