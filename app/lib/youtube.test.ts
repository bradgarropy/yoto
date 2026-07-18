import {describe, expect, it} from "vitest"

import {getYouTubeUrlType} from "./youtube"

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
