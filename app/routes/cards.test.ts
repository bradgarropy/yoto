import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EVENT} from "~/lib/telemetry.server"
import {authContext} from "~/middleware/auth.server"

import {action} from "./cards"

beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("cards action", () => {
    it("reports a completed card creation", async () => {
        const updateCard = vi.fn().mockResolvedValue({
            cardId: "new-card-id",
        })
        const formData = new FormData()
        formData.set("intent", "createCard")
        formData.set("cardName", "New Card")
        const request = new Request("https://example.com/cards", {
            method: "POST",
            body: formData,
        })
        const context = {
            get: vi.fn(key => {
                if (key === authContext) {
                    return {sdk: {content: {updateCard}}}
                }

                throw new Error("Unexpected context")
            }),
        }

        const result = await action({request, context} as never)

        expect(result).toEqual({success: true, cardId: "new-card-id"})
        expect(console.info).toHaveBeenCalledWith(
            expect.objectContaining({
                cardId: "new-card-id",
                durationMs: expect.any(Number),
                event: EVENT.CARD.CREATE.COMPLETED,
                level: "info",
            }),
        )
    })

    it("warns when a card name is missing", async () => {
        const formData = new FormData()
        formData.set("intent", "createCard")
        const request = new Request("https://example.com/cards", {
            method: "POST",
            body: formData,
        })

        const result = await action({
            request,
            context: {get: vi.fn()},
        } as never)

        expect(result).toEqual({error: "Card name is required"})
        expect(console.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                reason: "invalid_request",
                durationMs: expect.any(Number),
                event: EVENT.CARD.CREATE.FAILED,
                level: "warn",
            }),
        )
    })
})
