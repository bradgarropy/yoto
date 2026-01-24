import {spawn} from "child_process"
import {mkdir} from "fs/promises"
import {resolve, join} from "path"
import {homedir} from "os"
import {Options} from "~/index"

const DESKTOP_PATH = join(homedir(), "Desktop")

const isInstalled = async (): Promise<boolean> => {
    return new Promise(resolve => {
        const process = spawn("yt-dlp", ["--version"])

        process.on("error", () => resolve(false))
        process.on("close", code => resolve(code === 0))
    })
}

const getPlaylistTitle = async (playlistUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const args = [
            "--flat-playlist",
            "--print",
            "playlist_title",
            playlistUrl,
        ]
        const ytDlp = spawn("yt-dlp", args)

        let output = ""
        ytDlp.stdout.on("data", data => {
            output += data.toString()
        })

        ytDlp.on("error", error => {
            reject(new Error(`Failed to get playlist title: ${error.message}`))
        })

        ytDlp.on("close", code => {
            if (code === 0) {
                // Get the first line (playlist title is repeated for each video)
                const title = output.trim().split("\n")[0]
                // Sanitize the title for use as a folder name
                const sanitized = title.replace(/[<>:"/\\|?*]/g, "").trim()
                resolve(sanitized || "downloads")
            } else {
                reject(
                    new Error(
                        `Failed to get playlist title (exit code ${code})`,
                    ),
                )
            }
        })
    })
}

const downloadPlaylist = async (
    url: string,
    options: Options,
): Promise<void> => {
    // Determine output directory
    let outputDir: string
    if (options.directory) {
        outputDir = resolve(options.directory)
    } else {
        console.log("Fetching playlist info...")
        const playlistTitle = await getPlaylistTitle(url)
        outputDir = join(DESKTOP_PATH, playlistTitle)
    }

    // Ensure output directory exists
    await mkdir(outputDir, {recursive: true})

    console.log(`\nDownloading playlist to: ${outputDir}`)
    console.log(`URL: ${url}\n`)

    const outputTemplate = `${outputDir}/%(title)s.%(ext)s`

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
    ]

    const ytDlp = spawn("yt-dlp", args, {
        stdio: "inherit",
    })

    return new Promise((resolve, reject) => {
        ytDlp.on("error", error => {
            reject(new Error(`Failed to start yt-dlp: ${error.message}`))
        })

        ytDlp.on("close", code => {
            if (code === 0) {
                console.log("\nDownload complete!")
                resolve()
            } else {
                reject(new Error(`yt-dlp exited with code ${code}`))
            }
        })
    })
}

const downloadVideo = async (url: string, options: Options): Promise<void> => {
    // Determine output directory
    const outputDir = options.directory
        ? resolve(options.directory)
        : DESKTOP_PATH

    // Ensure output directory exists
    await mkdir(outputDir, {recursive: true})

    console.log(`\nDownloading video to: ${outputDir}`)
    console.log(`URL: ${url}\n`)

    const outputTemplate = `${outputDir}/%(title)s.%(ext)s`

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
    ]

    const ytDlp = spawn("yt-dlp", args, {
        stdio: "inherit",
    })

    return new Promise((resolve, reject) => {
        ytDlp.on("error", error => {
            reject(new Error(`Failed to start yt-dlp: ${error.message}`))
        })

        ytDlp.on("close", code => {
            if (code === 0) {
                console.log("\nDownload complete!")
                resolve()
            } else {
                reject(new Error(`yt-dlp exited with code ${code}`))
            }
        })
    })
}

export {isInstalled, getPlaylistTitle, downloadPlaylist, downloadVideo}
