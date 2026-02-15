import {getSandbox, type Sandbox} from "@cloudflare/sandbox"
import {Hono} from "hono"

// Re-export Sandbox class (required by Cloudflare)
export {Sandbox} from "@cloudflare/sandbox"

type Bindings = {
    SANDBOX: DurableObjectNamespace<Sandbox>
}

type Variables = {
    sandbox: ReturnType<typeof getSandbox>
}

const app = new Hono<{Bindings: Bindings; Variables: Variables}>()

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

// Default response
app.get("/", c => {
    return c.text(`Sandbox PoC Endpoints:

GET  /sandbox/health         - Health check
GET  /sandbox/yt-dlp-version - Check yt-dlp version
GET  /sandbox/ffmpeg-version - Check ffmpeg version
POST /sandbox/test-info      - Get video info (body: {"url": "..."})
POST /sandbox/test-download  - Download video as mp3 (body: {"url": "..."})

Test video: https://www.youtube.com/watch?v=R63Dnzexp-U
`)
})

export default app
