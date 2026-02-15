import {getSandbox} from "@cloudflare/sandbox"
import {Hono} from "hono"
import {createRequestHandler} from "react-router"

// Re-export Sandbox class (required by Cloudflare)
export {Sandbox} from "@cloudflare/sandbox"

// Variables stored in Hono context
type Variables = {
    sandbox: ReturnType<typeof getSandbox>
}

// Use Env from generated worker-configuration.d.ts
const app = new Hono<{Bindings: Env; Variables: Variables}>()

// ============ Sandbox Routes ============

// Middleware to attach sandbox to context
app.use("/sandbox/*", async (c, next) => {
    const sandbox = getSandbox(c.env.SANDBOX, "sync-worker")
    c.set("sandbox", sandbox)
    await next()
})

// Health check
app.get("/sandbox/health", c => {
    return c.json({
        status: "ok",
        timestamp: new Date().toISOString(),
    })
})

// Test yt-dlp version
app.get("/sandbox/yt-dlp-version", async c => {
    const sandbox = c.get("sandbox")
    const result = await sandbox.exec("yt-dlp --version")
    return c.json({
        version: result.stdout.trim(),
        success: result.success,
        error: result.stderr || null,
    })
})

// Test ffmpeg version
app.get("/sandbox/ffmpeg-version", async c => {
    const sandbox = c.get("sandbox")
    const result = await sandbox.exec("ffmpeg -version")
    const firstLine = result.stdout.split("\n")[0]
    return c.json({
        version: firstLine,
        success: result.success,
        error: result.stderr || null,
    })
})

// Test getting video info
app.post("/sandbox/test-info", async c => {
    const sandbox = c.get("sandbox")
    const {url: videoUrl} = await c.req.json<{url: string}>()

    const result = await sandbox.exec(
        `yt-dlp --no-check-certificates --print "%(id)s\t%(title)s\t%(duration)s" --no-playlist "${videoUrl}"`,
    )

    if (!result.success) {
        return c.json({success: false, error: result.stderr}, 500)
    }

    const [id, title, duration] = result.stdout.trim().split("\t")
    return c.json({
        success: true,
        info: {id, title, duration: parseInt(duration, 10)},
    })
})

// Test downloading a video
app.post("/sandbox/test-download", async c => {
    const sandbox = c.get("sandbox")
    const {url: videoUrl} = await c.req.json<{url: string}>()

    // Create temp directory
    await sandbox.exec("mkdir -p /tmp/yoto-test")

    // Download as mp3
    const downloadResult = await sandbox.exec(
        `yt-dlp --no-check-certificates --extract-audio --audio-format mp3 --audio-quality 0 ` +
            `-o "/tmp/yoto-test/%(id)s.%(ext)s" --no-playlist "${videoUrl}"`,
    )

    if (!downloadResult.success) {
        return c.json(
            {
                success: false,
                error: downloadResult.stderr,
                stdout: downloadResult.stdout,
            },
            500,
        )
    }

    // Check what was downloaded
    const lsResult = await sandbox.exec("ls -la /tmp/yoto-test/")

    // Clean up
    await sandbox.exec("rm -rf /tmp/yoto-test")

    return c.json({
        success: true,
        downloadOutput: downloadResult.stdout,
        files: lsResult.stdout,
    })
})

// ============ Import Endpoints (Production) ============

// Get playlist/video info
app.post("/sandbox/import/info", async c => {
    const sandbox = c.get("sandbox")
    const {url} = await c.req.json<{url: string}>()

    // Detect if URL is a playlist
    const isPlaylist = url.includes("list=")

    if (isPlaylist) {
        const result = await sandbox.exec(
            `yt-dlp --flat-playlist --print "%(playlist_id)s\t%(playlist_title)s\t%(id)s\t%(title)s" "${url}"`,
        )

        if (!result.success) {
            return c.json({success: false, error: result.stderr}, 500)
        }

        const lines = result.stdout.trim().split("\n").filter(Boolean)
        if (lines.length === 0) {
            return c.json(
                {success: false, error: "No tracks found in playlist"},
                400,
            )
        }

        // Parse first line to get playlist info
        const [playlistId, playlistTitle] = lines[0].split("\t")

        const tracks = lines.map(line => {
            const [, , videoId, title] = line.split("\t")
            return {
                id: videoId,
                title,
                url: `https://www.youtube.com/watch?v=${videoId}`,
            }
        })

        return c.json({
            success: true,
            id: playlistId,
            title: playlistTitle,
            tracks,
        })
    } else {
        const result = await sandbox.exec(
            `yt-dlp --print "%(id)s\t%(title)s" --no-playlist "${url}"`,
        )

        if (!result.success) {
            return c.json({success: false, error: result.stderr}, 500)
        }

        const line = result.stdout.trim()
        if (!line) {
            return c.json({success: false, error: "No video info found"}, 400)
        }

        const [videoId, title] = line.split("\t")

        return c.json({
            success: true,
            id: videoId,
            title,
            tracks: [
                {
                    id: videoId,
                    title,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                },
            ],
        })
    }
})

// Download a single track and return MP3 as binary
app.post("/sandbox/import/download", async c => {
    const sandbox = c.get("sandbox")
    const {trackId, trackUrl} = await c.req.json<{
        trackId: string
        trackUrl: string
    }>()

    const outputPath = `/tmp/${trackId}.mp3`

    // Download and convert to MP3
    // Note: Removed --cookies-from-browser chrome (not available in sandbox)
    const downloadResult = await sandbox.exec(
        `yt-dlp --extract-audio --audio-format mp3 --audio-quality 0 ` +
            `-o "${outputPath}" --no-playlist ` +
            `--extractor-args "youtube:player_client=tv" "${trackUrl}"`,
    )

    if (!downloadResult.success) {
        return c.json(
            {
                success: false,
                error: downloadResult.stderr || "Download failed",
            },
            500,
        )
    }

    // Read file as base64
    const readResult = await sandbox.exec(`base64 -w 0 "${outputPath}"`)

    if (!readResult.success) {
        return c.json(
            {success: false, error: "Failed to read downloaded file"},
            500,
        )
    }

    // Clean up
    await sandbox.exec(`rm -f "${outputPath}"`)

    // Convert base64 to binary and return as audio/mpeg
    const base64 = readResult.stdout.trim()
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }

    return new Response(bytes.buffer, {
        headers: {
            "Content-Type": "audio/mpeg",
            "Content-Length": bytes.length.toString(),
        },
    })
})

// ============ React Router (Catch-all) ============

// React Router request handler
// Note: Types will fully resolve after @react-router/cloudflare is installed (Task 17)
const requestHandler = createRequestHandler(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - virtual module provided by Vite at build time
    () => import("virtual:react-router/server-build"),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - import.meta.env is injected by Vite at build time
    import.meta.env.MODE,
)

app.all("*", async c => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - cloudflare context types resolve after @react-router/cloudflare is installed
    return requestHandler(c.req.raw, {
        cloudflare: {env: c.env, ctx: c.executionCtx},
    })
})

export default app
