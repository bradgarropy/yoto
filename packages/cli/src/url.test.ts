import {describe, expect, it} from "vitest"

import {isPlaylistUrl, isUrl, isVideoUrl} from "~/url"

describe("isUrl", () => {
    it("should return true for valid URLs", () => {
        expect(isUrl("https://www.youtube.com")).toBe(true)
        expect(isUrl("https://youtube.com/watch?v=abc123")).toBe(true)
        expect(isUrl("http://example.com")).toBe(true)
    })

    it("should return false for invalid URLs", () => {
        expect(isUrl("not a url")).toBe(false)
        expect(isUrl("youtube.com")).toBe(false)
        expect(isUrl("abc123")).toBe(false)
        expect(isUrl("")).toBe(false)
    })
})

describe("isPlaylistUrl", () => {
    it("should return true for playlist URLs with playlist?list=", () => {
        expect(
            isPlaylistUrl(
                "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
            ),
        ).toBe(true)
    })

    it("should return true for video URLs with &list=PL", () => {
        expect(
            isPlaylistUrl(
                "https://www.youtube.com/watch?v=abc123&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
            ),
        ).toBe(true)
    })

    it("should return false for video URLs without playlist", () => {
        expect(isPlaylistUrl("https://www.youtube.com/watch?v=abc123")).toBe(
            false,
        )
    })

    it("should return false for non-URLs", () => {
        expect(isPlaylistUrl("PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf")).toBe(false)
        expect(isPlaylistUrl("not a url")).toBe(false)
    })
})

describe("isVideoUrl", () => {
    it("should return true for video URLs without playlist", () => {
        expect(isVideoUrl("https://www.youtube.com/watch?v=abc123")).toBe(true)
        expect(isVideoUrl("https://youtu.be/abc123")).toBe(true)
    })

    it("should return false for playlist URLs", () => {
        expect(
            isVideoUrl(
                "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
            ),
        ).toBe(false)
        expect(
            isVideoUrl(
                "https://www.youtube.com/watch?v=abc123&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
            ),
        ).toBe(false)
    })

    it("should return false for non-URLs", () => {
        expect(isVideoUrl("abc123")).toBe(false)
        expect(isVideoUrl("not a url")).toBe(false)
    })
})
