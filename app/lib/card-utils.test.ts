import {describe, expect, it} from "vitest"

import {getCardCoverUrl} from "./card-utils"
import type {CardWithMetadata} from "./types"

describe("getCardCoverUrl", () => {
    it("should return undefined when no cover URLs exist", () => {
        const card: CardWithMetadata = {
            cardId: "123",
            title: "Test",
        }
        expect(getCardCoverUrl(card)).toBeUndefined()
    })

    it("should prefer metadata.cover.imageL", () => {
        const card: CardWithMetadata = {
            cardId: "123",
            title: "Test",
            cover: {
                imageL: "cover-L",
                imageM: "cover-M",
                imageS: "cover-S",
            },
            metadata: {
                cover: {
                    imageL: "meta-L",
                    imageM: "meta-M",
                    imageS: "meta-S",
                },
            },
        }
        expect(getCardCoverUrl(card)).toBe("meta-L")
    })

    it("should fall back to metadata.cover.imageM", () => {
        const card: CardWithMetadata = {
            cardId: "123",
            title: "Test",
            metadata: {
                cover: {
                    imageM: "meta-M",
                    imageS: "meta-S",
                },
            },
        }
        expect(getCardCoverUrl(card)).toBe("meta-M")
    })

    it("should fall back to metadata.cover.imageS", () => {
        const card: CardWithMetadata = {
            cardId: "123",
            title: "Test",
            metadata: {
                cover: {
                    imageS: "meta-S",
                },
            },
        }
        expect(getCardCoverUrl(card)).toBe("meta-S")
    })

    it("should fall back to cover.imageL when no metadata cover", () => {
        const card: CardWithMetadata = {
            cardId: "123",
            title: "Test",
            cover: {
                imageL: "cover-L",
                imageM: "cover-M",
                imageS: "cover-S",
            },
        }
        expect(getCardCoverUrl(card)).toBe("cover-L")
    })

    it("should fall back to cover.imageM", () => {
        const card: CardWithMetadata = {
            cardId: "123",
            title: "Test",
            cover: {
                imageM: "cover-M",
                imageS: "cover-S",
            },
        }
        expect(getCardCoverUrl(card)).toBe("cover-M")
    })

    it("should fall back to cover.imageS", () => {
        const card: CardWithMetadata = {
            cardId: "123",
            title: "Test",
            cover: {
                imageS: "cover-S",
            },
        }
        expect(getCardCoverUrl(card)).toBe("cover-S")
    })

    it("should return undefined when metadata.cover exists but is empty", () => {
        const card: CardWithMetadata = {
            cardId: "123",
            title: "Test",
            metadata: {
                cover: {},
            },
        }
        expect(getCardCoverUrl(card)).toBeUndefined()
    })

    it("should fall back to metadata.coverImageUrl when no other cover exists", () => {
        const card: CardWithMetadata = {
            cardId: "123",
            title: "Test",
            metadata: {
                coverImageUrl: "legacy-cover-url",
            },
        }
        expect(getCardCoverUrl(card)).toBe("legacy-cover-url")
    })

    it("should prefer metadata.cover over metadata.coverImageUrl", () => {
        const card: CardWithMetadata = {
            cardId: "123",
            title: "Test",
            metadata: {
                coverImageUrl: "legacy-cover-url",
                cover: {
                    imageL: "meta-L",
                },
            },
        }
        expect(getCardCoverUrl(card)).toBe("meta-L")
    })

    it("should prefer top-level cover over metadata.coverImageUrl", () => {
        const card: CardWithMetadata = {
            cardId: "123",
            title: "Test",
            cover: {
                imageS: "cover-S",
            },
            metadata: {
                coverImageUrl: "legacy-cover-url",
            },
        }
        expect(getCardCoverUrl(card)).toBe("cover-S")
    })
})
