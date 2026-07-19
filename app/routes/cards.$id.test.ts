import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {cloudflareContext} from "~/lib/cloudflare-context"
import {EVENT} from "~/lib/telemetry.server"
import {authContext} from "~/middleware/auth.server"

import {action, loader} from "./cards.$id"

const mockGetYotoIconUrlMap = vi.fn()

vi.mock("~/lib/yoto-icons.server", () => ({
    getNumberIcons: vi.fn(),
    getYotoIconUrlMap: (...args: unknown[]) => mockGetYotoIconUrlMap(...args),
}))

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("cards.$id loader", () => {
    it("resolves track icons from display icon catalogs without using card media URLs", async () => {
        const getMediaUrl = vi.fn()
        const sdk = {
            content: {
                getCard: vi.fn().mockResolvedValue({
                    cardId: "card-id",
                    title: "Test Card",
                    content: {
                        chapters: [
                            {
                                key: "01",
                                title: "Official icon",
                                duration: 120,
                                display: {icon16x16: "yoto:#official-id"},
                            },
                            {
                                key: "02",
                                title: "Missing icon",
                                duration: 180,
                                display: {icon16x16: "yoto:#missing-id"},
                            },
                        ],
                    },
                    metadata: {},
                }),
                getMyCards: vi.fn().mockResolvedValue([]),
            },
            extractMediaId: vi.fn((value: string) =>
                value.replace("yoto:#", ""),
            ),
            media: {
                getMediaUrl,
            },
        }
        const env = {} as Env
        const request = new Request("https://example.com/cards/card-id")
        const context = {
            get: vi.fn(key => {
                if (key === authContext) {
                    return {sdk}
                }

                if (key === cloudflareContext) {
                    return {env}
                }

                throw new Error("Unexpected context")
            }),
        }
        mockGetYotoIconUrlMap.mockResolvedValue(
            new Map([["official-id", "https://example.com/official.png"]]),
        )

        const result = await loader({
            params: {id: "card-id"},
            request,
            context,
        } as never)

        expect(result.tracks).toEqual([
            {
                key: "01",
                title: "Official icon",
                duration: 120,
                iconUrl: "https://example.com/official.png",
            },
            {
                key: "02",
                title: "Missing icon",
                duration: 180,
                iconUrl: undefined,
            },
        ])
        expect(getMediaUrl).not.toHaveBeenCalled()
    })
})

describe("cards.$id action", () => {
    it("deletes multiple tracks with one card update", async () => {
        const updateCard = vi.fn().mockResolvedValue(undefined)
        const sdk = {
            content: {
                getCard: vi.fn().mockResolvedValue({
                    cardId: "card-id",
                    title: "Test Card",
                    content: {
                        activity: "yoto_Player",
                        chapters: [
                            {key: "01", title: "One"},
                            {key: "02", title: "Two"},
                            {key: "03", title: "Three"},
                        ],
                        restricted: false,
                        config: {onlineOnly: false},
                        version: "1",
                    },
                    metadata: {},
                }),
                updateCard,
            },
        }
        const formData = new FormData()
        formData.set("intent", "deleteTracks")
        formData.set("trackKeys", JSON.stringify(["01", "03"]))
        const request = new Request("https://example.com/cards/card-id", {
            method: "POST",
            body: formData,
        })
        const context = {
            get: vi.fn(key => {
                if (key === authContext) {
                    return {sdk}
                }

                if (key === cloudflareContext) {
                    return {env: {} as Env}
                }

                throw new Error("Unexpected context")
            }),
        }

        const result = await action({
            params: {id: "card-id"},
            request,
            context,
        } as never)

        expect(result).toEqual({success: true, deletedCount: 2})
        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                cardId: "card-id",
                trackKeys: ["01", "03"],
                requestedCount: 2,
                succeededCount: 2,
                failedCount: 0,
                durationMs: expect.any(Number),
                event: EVENT.TRACK.DELETE.COMPLETED,
                level: "info",
            }),
        )
        expect(updateCard).toHaveBeenCalledExactlyOnceWith({
            cardId: "card-id",
            title: "Test Card",
            content: {
                activity: "yoto_Player",
                chapters: [{key: "02", title: "Two"}],
                restricted: false,
                config: {onlineOnly: false},
                version: "1",
            },
            metadata: {},
        })
    })

    it("copies multiple tracks in source order with one card update", async () => {
        const updateCard = vi.fn().mockResolvedValue(undefined)
        const sourceCard = {
            cardId: "card-id",
            title: "Source Card",
            content: {
                activity: "yoto_Player",
                chapters: [
                    {key: "01", title: "One"},
                    {key: "02", title: "Two"},
                    {key: "03", title: "Three"},
                ],
                restricted: false,
                config: {onlineOnly: false},
                version: "1",
            },
            metadata: {},
        }
        const destinationCard = {
            cardId: "destination-id",
            title: "Destination Card",
            content: {
                activity: "yoto_Player",
                chapters: [{key: "04", title: "Existing"}],
                restricted: false,
                config: {onlineOnly: false},
                version: "1",
            },
            metadata: {},
        }
        const sdk = {
            content: {
                getCard: vi.fn((cardId: string) =>
                    Promise.resolve(
                        cardId === "card-id" ? sourceCard : destinationCard,
                    ),
                ),
                updateCard,
            },
        }
        const formData = new FormData()
        formData.set("intent", "copyTracks")
        formData.set("trackKeys", JSON.stringify(["03", "01"]))
        formData.set("destinationCardId", "destination-id")
        const request = new Request("https://example.com/cards/card-id", {
            method: "POST",
            body: formData,
        })
        const context = {
            get: vi.fn(key => {
                if (key === authContext) {
                    return {sdk}
                }

                if (key === cloudflareContext) {
                    return {env: {} as Env}
                }

                throw new Error("Unexpected context")
            }),
        }

        const result = await action({
            params: {id: "card-id"},
            request,
            context,
        } as never)

        expect(result).toEqual({
            success: true,
            copied: true,
            copiedCount: 2,
            destinationCardTitle: "Destination Card",
        })
        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                cardId: "card-id",
                destinationCardId: "destination-id",
                trackKeys: ["03", "01"],
                requestedCount: 2,
                succeededCount: 2,
                failedCount: 0,
                durationMs: expect.any(Number),
                event: EVENT.TRACK.COPY.COMPLETED,
                level: "info",
            }),
        )
        expect(updateCard).toHaveBeenCalledExactlyOnceWith({
            cardId: "destination-id",
            title: "Destination Card",
            content: {
                activity: "yoto_Player",
                chapters: [
                    {key: "04", title: "Existing"},
                    {key: "05", title: "One"},
                    {key: "06", title: "Three"},
                ],
                restricted: false,
                config: {onlineOnly: false},
                version: "1",
            },
            metadata: {},
        })
    })

    it("warns when a copy request targets the source card", async () => {
        const formData = new FormData()
        formData.set("intent", "copyTrack")
        formData.set("trackKey", "01")
        formData.set("destinationCardId", "card-id")
        const request = new Request("https://example.com/cards/card-id", {
            method: "POST",
            body: formData,
        })
        const context = {
            get: vi.fn(key => {
                if (key === authContext) {
                    return {sdk: {}}
                }

                if (key === cloudflareContext) {
                    return {env: {} as Env}
                }

                throw new Error("Unexpected context")
            }),
        }

        const result = await action({
            params: {id: "card-id"},
            request,
            context,
        } as never)

        expect(result).toEqual({
            error: "Cannot copy a track to the same card",
        })
        expect(console.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                cardId: "card-id",
                destinationCardId: "card-id",
                trackKeys: ["01"],
                requestedCount: 1,
                succeededCount: 0,
                failedCount: 1,
                reason: "same_card",
                durationMs: expect.any(Number),
                event: EVENT.TRACK.COPY.FAILED,
                level: "warn",
            }),
        )
    })

    it("warns when a single track to delete is not found", async () => {
        const sdk = {
            content: {
                getCard: vi.fn().mockResolvedValue({
                    cardId: "card-id",
                    title: "Test Card",
                    content: {
                        chapters: [{key: "01", title: "One"}],
                    },
                    metadata: {},
                }),
                updateCard: vi.fn(),
            },
        }
        const formData = new FormData()
        formData.set("intent", "deleteTrack")
        formData.set("trackKey", "02")
        const request = new Request("https://example.com/cards/card-id", {
            method: "POST",
            body: formData,
        })
        const context = {
            get: vi.fn(key => {
                if (key === authContext) {
                    return {sdk}
                }

                if (key === cloudflareContext) {
                    return {env: {} as Env}
                }

                throw new Error("Unexpected context")
            }),
        }

        const result = await action({
            params: {id: "card-id"},
            request,
            context,
        } as never)

        expect(result).toEqual({error: "Track not found"})
        expect(sdk.content.updateCard).not.toHaveBeenCalled()
        expect(console.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                cardId: "card-id",
                trackKeys: ["02"],
                requestedCount: 1,
                succeededCount: 0,
                failedCount: 1,
                reason: "track_not_found",
                event: EVENT.TRACK.DELETE.FAILED,
                level: "warn",
            }),
        )
    })
})
