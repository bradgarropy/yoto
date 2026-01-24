#!/usr/bin/env node

import {program} from "commander"
import {isUrl} from "~/url"
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
    .description("Download YouTube videos or playlists as audio files")
    .version("1.0.0")
    .argument("<input>", "YouTube video/playlist URL or ID")
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
