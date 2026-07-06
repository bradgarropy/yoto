import type {DisplayIcon} from "@yotoplay/yoto-sdk"

import {getAuthenticatedSdk, getToken} from "./auth.server"

// Cache for Yoto icons (module-level, shared across requests)
let iconCache: YotoIcon[] | null = null
let cacheTimestamp: number = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

type YotoIcon = {
    id: string // mediaId (the hash)
    title: string
    tags: string[] // publicTags from API
    url: string
}

const toYotoIcon = (icon: DisplayIcon): YotoIcon => ({
    id: icon.mediaId,
    title: icon.title,
    tags: icon.publicTags,
    url: icon.url,
})

// Fetch all native Yoto icons from API (with in-memory cache)
const fetchYotoIcons = async (
    request: Request,
    env: Env,
): Promise<YotoIcon[]> => {
    const now = Date.now()

    // Return cached icons if still valid
    if (iconCache && now - cacheTimestamp < CACHE_TTL_MS) {
        return iconCache
    }

    // Fetch fresh icons from API
    const {sdk} = await getAuthenticatedSdk(request, env)
    const icons: DisplayIcon[] = await sdk.icons.getDisplayIcons()

    const yotoIcons = icons.map(toYotoIcon)

    // Update cache
    iconCache = yotoIcons
    cacheTimestamp = now

    return yotoIcons
}

// Fetch icons uploaded to the current user's Yoto account.
// Do not cache this globally because it is user-specific.
const fetchUserYotoIcons = async (
    request: Request,
    env: Env,
): Promise<YotoIcon[]> => {
    const tokenResult = await getToken(request, env)

    if (!tokenResult) {
        return []
    }

    const response = await fetch(
        "https://api.yotoplay.com/media/displayIcons/user/me",
        {
            headers: {
                Authorization: `Bearer ${tokenResult.token}`,
            },
        },
    )

    if (!response.ok) {
        throw new Error(
            `Yoto user icons request failed: ${response.status} ${response.statusText}`,
        )
    }

    const result = (await response.json()) as {displayIcons?: DisplayIcon[]}
    return (result.displayIcons ?? []).map(toYotoIcon)
}

// Search native Yoto icons by query (filters by title and tags)
const searchYotoIcons = async (
    request: Request,
    env: Env,
    query: string,
): Promise<YotoIcon[]> => {
    const icons = await fetchYotoIcons(request, env)
    const lowerQuery = query.toLowerCase()

    const filtered = icons.filter(icon => {
        // Check if query matches title
        if (icon.title?.toLowerCase().includes(lowerQuery)) {
            return true
        }

        // Check if query matches any tag
        return icon.tags?.some(tag => tag?.toLowerCase().includes(lowerQuery))
    })

    // Dedupe by id (mediaId)
    const seen = new Set<string>()
    return filtered.filter(icon => {
        if (seen.has(icon.id)) {
            return false
        }
        seen.add(icon.id)
        return true
    })
}

// Get number icons (1-30) mapped by position number to mediaId
// Uses the "Number - 1" / "Numbers - N" title pattern from Yoto's official icons
const getNumberIcons = async (
    request: Request,
    env: Env,
): Promise<Map<number, string>> => {
    const icons = await fetchYotoIcons(request, env)
    const numberPattern = /^Numbers?\s*-\s*(\d+)$/
    const numberMap = new Map<number, string>()

    for (const icon of icons) {
        const match = icon.title?.match(numberPattern)
        if (match) {
            const num = parseInt(match[1], 10)
            if (!numberMap.has(num)) {
                numberMap.set(num, icon.id)
            }
        }
    }

    return numberMap
}

// Get official and user-uploaded Yoto icon URLs by mediaId. Card chapters only
// store "yoto:#mediaId", so this lets us render icons without the card media API.
const getYotoIconUrlMap = async (
    request: Request,
    env: Env,
): Promise<Map<string, string>> => {
    const [officialIcons, userIcons] = await Promise.all([
        fetchYotoIcons(request, env),
        fetchUserYotoIcons(request, env),
    ])

    const icons = [...officialIcons, ...userIcons]
    return new Map(icons.map(icon => [icon.id, icon.url]))
}

// Clear the icon cache (exported for testing)
const clearIconCache = () => {
    iconCache = null
    cacheTimestamp = 0
}

export {
    clearIconCache,
    fetchUserYotoIcons,
    fetchYotoIcons,
    getNumberIcons,
    getYotoIconUrlMap,
    searchYotoIcons,
}
export type {YotoIcon}
