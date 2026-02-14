import {getSandbox, type Sandbox} from "@cloudflare/sandbox"

// Re-export Sandbox class (required by Cloudflare)
export {Sandbox} from "@cloudflare/sandbox"

type Env = {
    SANDBOX: DurableObjectNamespace<Sandbox>
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url)
        const sandbox = getSandbox(env.SANDBOX, "sync-worker")

        // Health check
        if (url.pathname === "/sandbox/health") {
            return Response.json({
                status: "ok",
                timestamp: new Date().toISOString(),
            })
        }

        // Test yt-dlp version
        if (url.pathname === "/sandbox/yt-dlp-version") {
            const result = await sandbox.exec("yt-dlp --version")
            return Response.json({
                version: result.stdout.trim(),
                success: result.success,
                error: result.stderr || null,
            })
        }

        // Test ffmpeg version
        if (url.pathname === "/sandbox/ffmpeg-version") {
            const result = await sandbox.exec("ffmpeg -version")
            // ffmpeg outputs version to stdout, first line only
            const firstLine = result.stdout.split("\n")[0]
            return Response.json({
                version: firstLine,
                success: result.success,
                error: result.stderr || null,
            })
        }

        // Test getting video info
        if (
            url.pathname === "/sandbox/test-info" &&
            request.method === "POST"
        ) {
            const body = (await request.json()) as {url: string}
            const videoUrl = body.url

            const result = await sandbox.exec(
                `yt-dlp --no-check-certificates --print "%(id)s\t%(title)s\t%(duration)s" --no-playlist "${videoUrl}"`,
            )

            if (!result.success) {
                return Response.json(
                    {success: false, error: result.stderr},
                    {status: 500},
                )
            }

            const [id, title, duration] = result.stdout.trim().split("\t")
            return Response.json({
                success: true,
                info: {id, title, duration: parseInt(duration, 10)},
            })
        }

        // Test downloading a video
        if (
            url.pathname === "/sandbox/test-download" &&
            request.method === "POST"
        ) {
            const body = (await request.json()) as {url: string}
            const videoUrl = body.url

            // Create temp directory
            await sandbox.exec("mkdir -p /tmp/yoto-test")

            // Download as mp3
            const downloadResult = await sandbox.exec(
                `yt-dlp --no-check-certificates --extract-audio --audio-format mp3 --audio-quality 0 ` +
                    `-o "/tmp/yoto-test/%(id)s.%(ext)s" --no-playlist "${videoUrl}"`,
            )

            if (!downloadResult.success) {
                return Response.json(
                    {
                        success: false,
                        error: downloadResult.stderr,
                        stdout: downloadResult.stdout,
                    },
                    {status: 500},
                )
            }

            // Check what was downloaded
            const lsResult = await sandbox.exec("ls -la /tmp/yoto-test/")

            // Clean up
            await sandbox.exec("rm -rf /tmp/yoto-test")

            return Response.json({
                success: true,
                downloadOutput: downloadResult.stdout,
                files: lsResult.stdout,
            })
        }

        // Default response with usage instructions
        return new Response(
            `Sandbox PoC Endpoints:

GET  /sandbox/health         - Health check
GET  /sandbox/yt-dlp-version - Check yt-dlp version
GET  /sandbox/ffmpeg-version - Check ffmpeg version
POST /sandbox/test-info      - Get video info (body: {"url": "..."})
POST /sandbox/test-download  - Download video as mp3 (body: {"url": "..."})

Test video: https://www.youtube.com/watch?v=R63Dnzexp-U
`,
            {headers: {"Content-Type": "text/plain"}},
        )
    },
}
