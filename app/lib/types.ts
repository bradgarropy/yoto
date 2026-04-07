import type {UserCard} from "@yotoplay/yoto-sdk"

/**
 * The Yoto API returns metadata.cover on cards, but the SDK's UserCard type
 * doesn't include it. This extended type accounts for that.
 */
export type CardWithMetadata = UserCard & {
    metadata?: {
        coverImageUrl?: string
        cover?: {
            imageL?: string
            imageM?: string
            imageS?: string
        }
    }
}

/**
 * Lightweight card summary used when presenting a list of cards
 * for transferring tracks between cards.
 */
export type TransferCard = {
    id: string
    title: string
    coverUrl: string | undefined
}

/**
 * Full card data as returned by sdk.content.getCard().
 * The SDK types this as YotoJson which is too loose, so we define the
 * actual shape here to avoid repeating inline type assertions.
 */
export type CardData = {
    cardId: string
    title?: string
    cover?: {
        imageL?: string
        imageM?: string
        imageS?: string
    }
    content: {
        activity: string
        chapters: Array<{
            key?: string
            title?: string
            duration?: number
            display?: {icon16x16?: string} | null
            tracks?: Array<{
                trackUrl?: string
                display?: {icon16x16?: string} | null
                [key: string]: unknown
            }>
            [key: string]: unknown
        }>
        restricted: boolean
        config: {onlineOnly: boolean}
        version: string
    }
    metadata: Record<string, unknown> & {
        coverImageUrl?: string
        cover?: {
            imageL?: string
            imageM?: string
            imageS?: string
        }
    }
}
