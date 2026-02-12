import type {DisplayIcon} from "@yotoplay/yoto-sdk"

import {getAuthenticatedSdk} from "./auth.server"

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

// Fetch all native Yoto icons from API (with in-memory cache)
const fetchYotoIcons = async (): Promise<YotoIcon[]> => {
    const now = Date.now()

    // Return cached icons if still valid
    if (iconCache && now - cacheTimestamp < CACHE_TTL_MS) {
        return iconCache
    }

    // Fetch fresh icons from API
    const sdk = await getAuthenticatedSdk()
    const icons: DisplayIcon[] = await sdk.icons.getDisplayIcons()

    const yotoIcons = icons.map(icon => ({
        id: icon.mediaId,
        title: icon.title,
        tags: icon.publicTags,
        url: icon.url,
    }))

    // Update cache
    iconCache = yotoIcons
    cacheTimestamp = now

    return yotoIcons
}

// Search native Yoto icons by query (filters by title and tags)
const searchYotoIcons = async (query: string): Promise<YotoIcon[]> => {
    const icons = await fetchYotoIcons()
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

// Clear the icon cache (exported for testing)
const clearIconCache = () => {
    iconCache = null
    cacheTimestamp = 0
}

export {clearIconCache, fetchYotoIcons, searchYotoIcons}
export type {YotoIcon}
