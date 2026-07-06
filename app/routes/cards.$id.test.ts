import {describe, expect, it, vi} from "vitest"

import {cloudflareContext} from "~/lib/cloudflare-context"
import {authContext} from "~/middleware/auth.server"

import {loader} from "./cards.$id"

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
