import type {UserCard} from "@yotoplay/yoto-sdk"

/**
 * The Yoto API returns metadata.cover on cards, but the SDK's UserCard type
 * doesn't include it. This extended type accounts for that.
 */
export type CardWithMetadata = UserCard & {
    metadata?: {
        cover?: {imageL?: string; imageM?: string; imageS?: string}
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
 * Extract the best available cover image URL from a card.
 * Checks metadata.cover first, then falls back to the top-level cover.
 */
export function getCardCoverUrl(card: CardWithMetadata): string | undefined {
    return (
        card.metadata?.cover?.imageL ??
        card.metadata?.cover?.imageM ??
        card.metadata?.cover?.imageS ??
        card.cover?.imageL ??
        card.cover?.imageM ??
        card.cover?.imageS
    )
}
