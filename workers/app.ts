import {getSandbox} from "@cloudflare/sandbox"
import {Hono} from "hono"
import {createRequestHandler, RouterContextProvider} from "react-router"

import {cloudflareContext} from "../app/lib/cloudflare-context"

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

// Diagnostic endpoint to debug yt-dlp EJS setup
app.get("/sandbox/debug-ejs", async c => {
    const sandbox = c.get("sandbox")

    // Check Node.js version
    const nodeResult = await sandbox.exec("node --version")

    // Check where node is located
    const whichNodeResult = await sandbox.exec("which node")

    // Check Bun version (alternative JS runtime)
    const bunResult = await sandbox.exec("bun --version")

    // Check if yt-dlp-ejs is installed
    const ejsResult = await sandbox.exec(
        "pip show yt-dlp-ejs 2>&1 || echo 'not found'",
    )

    // Check yt-dlp config
    const configResult = await sandbox.exec("yt-dlp --dump-user-agent")

    // List available JS runtimes that yt-dlp can detect
    const runtimesResult = await sandbox.exec(
        "yt-dlp --verbose --skip-download --print '%(id)s' 'https://www.youtube.com/watch?v=jNQXAC9IVRw' 2>&1 | head -50",
    )

    return c.json({
        node: {
            version: nodeResult.stdout.trim(),
            path: whichNodeResult.stdout.trim(),
            success: nodeResult.success,
        },
        bun: {
            version: bunResult.stdout.trim(),
            success: bunResult.success,
        },
        ejsPackage: ejsResult.stdout.trim(),
        userAgent: configResult.stdout.trim(),
        verboseOutput: runtimesResult.stdout + (runtimesResult.stderr || ""),
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

    // Download as mp3 using Node for JS challenge solving
    const downloadResult = await sandbox.exec(
        `yt-dlp --no-check-certificates --js-runtimes node:/usr/local/bin/node --extract-audio --audio-format mp3 --audio-quality 0 ` +
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
            `yt-dlp --no-check-certificates --flat-playlist --print "%(playlist_id)s\t%(playlist_title)s\t%(id)s\t%(title)s" "${url}"`,
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
            `yt-dlp --no-check-certificates --print "%(id)s\t%(title)s" --no-playlist "${url}"`,
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
    // Note: --js-runtimes node:/usr/local/bin/node specifies the full path to Node for EJS challenge solving
    // Note: --no-check-certificates may be needed depending on network environment
    const downloadResult = await sandbox.exec(
        `yt-dlp --no-check-certificates --js-runtimes node:/usr/local/bin/node --extract-audio --audio-format mp3 --audio-quality 0 ` +
            `-o "${outputPath}" --no-playlist "${trackUrl}"`,
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
    // Create RouterContextProvider with cloudflare context for middleware support
    const contextProvider = new RouterContextProvider()
    // @ts-expect-error - Hono's ExecutionContext is compatible with what we need
    contextProvider.set(cloudflareContext, {env: c.env, ctx: c.executionCtx})
    // @ts-expect-error - RouterContextProvider is the correct type when middleware is enabled
    return requestHandler(c.req.raw, contextProvider)
})

export default app
