import {describe, expect, it} from "vitest"

import {
    getCanonicalYouTubeUrl,
    getYouTubeUrlType,
    isYouTubeMix,
} from "./youtube"

describe("isYouTubeMix", () => {
    it.each([
        "https://www.youtube.com/watch?v=abc123&list=RDabc123&start_radio=1",
        "https://www.youtube.com/watch?v=abc123&list=RDabc123",
        "https://www.youtube.com/playlist?list=RDabc123",
    ])("identifies a YouTube Mix URL: %s", url => {
        expect(isYouTubeMix(url)).toBe(true)
    })

    it.each([
        "https://www.youtube.com/playlist?list=PL123",
        "https://www.youtube.com/watch?v=abc123&list=PL123&start_radio=1",
        "https://www.youtube.com/watch?v=abc123",
        "not a URL",
    ])("does not identify a non-Mix URL: %s", url => {
        expect(isYouTubeMix(url)).toBe(false)
    })
})

describe("getYouTubeUrlType", () => {
    it.each([
        "https://www.youtube.com/watch?v=abc123",
        "https://youtube.com/watch?v=abc123",
        "https://m.youtube.com/watch?v=abc123",
        "https://youtu.be/abc123",
    ])("identifies a video URL: %s", url => {
        expect(getYouTubeUrlType(url)).toBe("video")
    })

    it.each([
        "https://www.youtube.com/playlist?list=PL123",
        "https://www.youtube.com/watch?v=abc123&list=PL123",
        "https://youtu.be/abc123?list=PL123",
    ])("identifies a playlist URL: %s", url => {
        expect(getYouTubeUrlType(url)).toBe("playlist")
    })

    it.each([
        "",
        "not a URL",
        "https://example.com/watch?v=abc123",
        "https://www.youtube.com/",
        "https://www.youtube.com/watch",
        "https://www.youtube.com/shorts/abc123",
    ])("returns unknown for an unsupported URL: %s", url => {
        expect(getYouTubeUrlType(url)).toBe("unknown")
    })
})

describe("getCanonicalYouTubeUrl", () => {
    it.each([
        "https://www.youtube.com/watch?v=abc123&t=30&feature=share",
        "https://youtu.be/abc123?t=30",
    ])("canonicalizes a video URL: %s", url => {
        expect(getCanonicalYouTubeUrl(url)).toBe(
            "https://www.youtube.com/watch?v=abc123",
        )
    })

    it.each([
        "https://www.youtube.com/playlist?list=PL123&si=tracking",
        "https://www.youtube.com/watch?v=abc123&list=PL123&index=2",
    ])("canonicalizes a playlist URL: %s", url => {
        expect(getCanonicalYouTubeUrl(url)).toBe(
            "https://www.youtube.com/playlist?list=PL123",
        )
    })

    it("preserves an unsupported URL", () => {
        expect(getCanonicalYouTubeUrl("https://example.com/video")).toBe(
            "https://example.com/video",
        )
    })
})
