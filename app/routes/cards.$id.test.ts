import {describe, expect, it, vi} from "vitest"

import {cloudflareContext} from "~/lib/cloudflare-context"
import {authContext} from "~/middleware/auth.server"

import {action, loader} from "./cards.$id"

const mockGetYotoIconUrlMap = vi.fn()

vi.mock("~/lib/yoto-icons.server", () => ({
    getNumberIcons: vi.fn(),
    getYotoIconUrlMap: (...args: unknown[]) => mockGetYotoIconUrlMap(...args),
}))

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
})
