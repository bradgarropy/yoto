/**
 * One-off script to rename a track title via the Yoto API.
 *
 * Usage: npx tsx scripts/rename-track.ts <cardId> <oldTitle> <newTitle>
 * Example: npx tsx scripts/rename-track.ts gZFfx "Dance Mode" "Dance Mode (Renamed)"
 */

import {homedir} from "node:os"
import {join} from "node:path"

import {DeviceCodeAuth, TokenManager} from "@yotoplay/oauth-device-code-flow"
import {createYotoSdk} from "@yotoplay/yoto-sdk"

// Strip null values (Yoto API rejects them)
const stripNullValues = <T>(obj: T): T => {
    if (obj === null || obj === undefined) {
        return obj
    }
    if (Array.isArray(obj)) {
        return obj.map(stripNullValues) as T
    }
    if (typeof obj === "object") {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null) {
                result[key] = stripNullValues(value)
            }
        }
        return result as T
    }
    return obj
}

const CONFIG_PATH = join(homedir(), ".config", "yoto")
const TOKEN_PATH = join(CONFIG_PATH, "auth.json")

const AUTH_CONFIG = {
    domain: "login.yotoplay.com",
    clientId: "PhKouPhz6NPVaWLtyeiEwjfB7m8sVR77",
    audience: "https://api.yotoplay.com",
}

type YotoChapter = {
    key: string
    title: string
    tracks?: Array<{title: string; [key: string]: unknown}>
    [key: string]: unknown
}

type YotoCard = {
    cardId: string
    title: string
    content: {
        chapters: YotoChapter[]
        [key: string]: unknown
    }
    metadata: Record<string, unknown>
}

async function main() {
    const [cardId, oldTitle, newTitle] = process.argv.slice(2)

    if (!cardId || !oldTitle || !newTitle) {
        console.error(
            "Usage: npx tsx scripts/rename-track.ts <cardId> <oldTitle> <newTitle>",
        )
        process.exit(1)
    }

    console.log(
        `Renaming "${oldTitle}" to "${newTitle}" on card ${cardId}...\n`,
    )

    // Auth
    const tokenManager = new TokenManager(TOKEN_PATH)
    const tokens = await tokenManager.loadTokens()

    if (!tokens) {
        throw new Error("Not logged in. Please run the app and log in first.")
    }

    let accessToken = tokens.accessToken

    if (tokenManager.isTokenExpired(tokens)) {
        if (!tokens.refreshToken) {
            throw new Error("Token expired. Please log in again.")
        }

        const auth = new DeviceCodeAuth(AUTH_CONFIG)
        const result = await auth.refreshToken(tokens.refreshToken)

        if (!result.success || !result.tokens) {
            throw new Error("Failed to refresh token. Please log in again.")
        }

        await tokenManager.saveTokens(result.tokens)
        accessToken = result.tokens.accessToken
    }

    const sdk = createYotoSdk({jwt: accessToken})

    // Fetch card
    const card = (await sdk.content.getCard(cardId)) as unknown as YotoCard

    console.log("Card title:", card.title)
    console.log(
        "Chapters:",
        card.content.chapters.map(c => c.title),
    )

    // Find the chapter
    const chapter = card.content.chapters.find(c => c.title === oldTitle)

    if (!chapter) {
        console.error(`\nChapter "${oldTitle}" not found!`)
        process.exit(1)
    }

    // Rename chapter
    chapter.title = newTitle

    // Also rename the track inside the chapter
    if (chapter.tracks?.[0]) {
        chapter.tracks[0].title = newTitle
    }

    // Update card
    try {
        await sdk.content.updateCard(
            stripNullValues({
                cardId: card.cardId,
                title: card.title,
                content: card.content,
                metadata: card.metadata,
            }) as Parameters<typeof sdk.content.updateCard>[0],
        )

        console.log(`\nDone! Renamed "${oldTitle}" to "${newTitle}"`)
    } catch (e) {
        console.error("\nUpdate failed!")
        if (e instanceof Error && "response" in e) {
            const axiosError = e as Error & {
                response?: {status?: number; data?: unknown}
            }
            console.error("Status:", axiosError.response?.status)
            console.error(
                "Data:",
                JSON.stringify(axiosError.response?.data, null, 2),
            )
        }
        throw e
    }
}

main().catch(e => {
    console.error("Error:", e.message)
    process.exit(1)
})
