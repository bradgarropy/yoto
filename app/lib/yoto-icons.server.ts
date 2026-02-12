import type {DisplayIcon} from "@yotoplay/yoto-sdk"

import {getAuthenticatedSdk} from "./auth.server"

type YotoIcon = {
    id: string // mediaId (the hash)
    title: string
    tags: string[] // publicTags from API
    url: string
}

// Fetch all native Yoto icons from API
const fetchYotoIcons = async (): Promise<YotoIcon[]> => {
    const sdk = await getAuthenticatedSdk()
    const icons: DisplayIcon[] = await sdk.icons.getDisplayIcons()

    return icons.map(icon => ({
        id: icon.mediaId,
        title: icon.title,
        tags: icon.publicTags,
        url: icon.url,
    }))
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

export {fetchYotoIcons, searchYotoIcons}
export type {YotoIcon}
