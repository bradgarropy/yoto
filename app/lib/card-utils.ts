import type {CardData} from "~/lib/types"

/**
 * Extract the best available cover image URL from a card.
 * Checks metadata.cover first, then top-level cover, then
 * metadata.coverImageUrl as a final fallback.
 */
const getCardCoverUrl = (card: Partial<CardData>): string | undefined => {
    return (
        card.metadata?.cover?.imageL ??
        card.metadata?.cover?.imageM ??
        card.metadata?.cover?.imageS ??
        card.cover?.imageL ??
        card.cover?.imageM ??
        card.cover?.imageS ??
        card.metadata?.coverImageUrl
    )
}

export {getCardCoverUrl}
