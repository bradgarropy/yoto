#!/usr/bin/env node
import { program } from "commander";
import { spawn } from "child_process";
import { mkdir } from "fs/promises";
import { resolve, join } from "path";
import { homedir } from "os";
const DESKTOP = join(homedir(), "Desktop");
function parseInput(input) {
    // Full YouTube URL
    if (input.startsWith("http://") || input.startsWith("https://")) {
        // Check if it's a playlist URL
        if (input.includes("playlist?list=") || input.includes("&list=PL")) {
            return { type: "playlist", url: input };
        }
        // Otherwise treat as video URL
        return { type: "video", url: input };
    }
    // Playlist ID (starts with PL)
    if (input.startsWith("PL")) {
        return {
            type: "playlist",
            url: `https://www.youtube.com/playlist?list=${input}`,
        };
    }
    // Video ID (typically 11 characters)
    return {
        type: "video",
        url: `https://www.youtube.com/watch?v=${input}`,
    };
}
async function checkYtDlp() {
    return new Promise((resolve) => {
        const process = spawn("yt-dlp", ["--version"]);
        process.on("error", () => resolve(false));
        process.on("close", (code) => resolve(code === 0));
    });
}
async function getPlaylistTitle(playlistUrl) {
    return new Promise((resolve, reject) => {
        const args = ["--flat-playlist", "--print", "playlist_title", playlistUrl];
        const ytDlp = spawn("yt-dlp", args);
        let output = "";
        ytDlp.stdout.on("data", (data) => {
            output += data.toString();
        });
        ytDlp.on("error", (error) => {
            reject(new Error(`Failed to get playlist title: ${error.message}`));
        });
        ytDlp.on("close", (code) => {
            if (code === 0) {
                // Get the first line (playlist title is repeated for each video)
                const title = output.trim().split("\n")[0];
                // Sanitize the title for use as a folder name
                const sanitized = title.replace(/[<>:"/\\|?*]/g, "").trim();
                resolve(sanitized || "downloads");
            }
            else {
                reject(new Error(`Failed to get playlist title (exit code ${code})`));
            }
        });
    });
}
async function downloadPlaylist(url, options) {
    // Determine output directory
    let outputDir;
    if (options.directory) {
        outputDir = resolve(options.directory);
    }
    else {
        console.log("Fetching playlist info...");
        const playlistTitle = await getPlaylistTitle(url);
        outputDir = join(DESKTOP, playlistTitle);
    }
    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });
    console.log(`\nDownloading playlist to: ${outputDir}`);
    console.log(`URL: ${url}\n`);
    const outputTemplate = `${outputDir}/%(title)s.%(ext)s`;
    const args = [
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "-o",
        outputTemplate,
        "--no-playlist-reverse",
        "--progress",
        url,
    ];
    const ytDlp = spawn("yt-dlp", args, {
        stdio: "inherit",
    });
    return new Promise((resolve, reject) => {
        ytDlp.on("error", (error) => {
            reject(new Error(`Failed to start yt-dlp: ${error.message}`));
        });
        ytDlp.on("close", (code) => {
            if (code === 0) {
                console.log("\nDownload complete!");
                resolve();
            }
            else {
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });
    });
}
async function downloadVideo(url, options) {
    // Determine output directory
    const outputDir = options.directory ? resolve(options.directory) : DESKTOP;
    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });
    console.log(`\nDownloading video to: ${outputDir}`);
    console.log(`URL: ${url}\n`);
    const outputTemplate = `${outputDir}/%(title)s.%(ext)s`;
    const args = [
        "--extract-audio",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "-o",
        outputTemplate,
        "--no-playlist",
        "--progress",
        url,
    ];
    const ytDlp = spawn("yt-dlp", args, {
        stdio: "inherit",
    });
    return new Promise((resolve, reject) => {
        ytDlp.on("error", (error) => {
            reject(new Error(`Failed to start yt-dlp: ${error.message}`));
        });
        ytDlp.on("close", (code) => {
            if (code === 0) {
                console.log("\nDownload complete!");
                resolve();
            }
            else {
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });
    });
}
program
    .name("yoto")
    .description("Download YouTube videos or playlists as audio files")
    .version("1.0.0")
    .argument("<input>", "YouTube video/playlist URL or ID")
    .option("-d, --directory <dir>", "Output directory (defaults to ~/Desktop)")
    .action(async (input, options) => {
    // Check if yt-dlp is installed
    const hasYtDlp = await checkYtDlp();
    if (!hasYtDlp) {
        console.error("Error: yt-dlp is not installed or not in PATH");
        console.error("\nInstall it with:");
        console.error("  brew install yt-dlp ffmpeg  (macOS)");
        console.error("  pip install yt-dlp          (pip)");
        process.exit(1);
    }
    try {
        const parsed = parseInput(input);
        if (parsed.type === "playlist") {
            console.log("Detected: playlist");
            await downloadPlaylist(parsed.url, options);
        }
        else {
            console.log("Detected: single video");
            await downloadVideo(parsed.url, options);
        }
    }
    catch (error) {
        console.error(`\nError: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
    }
});
program.parse();
