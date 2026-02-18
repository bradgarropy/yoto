import {describe, expect, it} from "vitest"

import {createChapter, getProgressPercent, stripNullValues} from "./sync-utils"

describe("getProgressPercent", () => {
    it("should return 0 when progress is null", () => {
        expect(getProgressPercent(null)).toBe(0)
    })

    it("should return 0 for fetching phase (preparing)", () => {
        expect(getProgressPercent({phase: "fetching"})).toBe(0)
    })

    it("should return 95 for updating phase (finalizing)", () => {
        expect(getProgressPercent({phase: "updating"})).toBe(95)
    })

    it("should return 5 for downloading phase without counts", () => {
        expect(getProgressPercent({phase: "downloading"})).toBe(5)
    })

    it("should return 5 for transcoding phase without counts", () => {
        expect(getProgressPercent({phase: "transcoding"})).toBe(5)
    })

    it("should calculate progress for downloading phase", () => {
        // 2 tracks: trackSlice=45, phaseSlice=15
        // track 1: 5 + (0 * 45) + (0 * 15) = 5%
        expect(
            getProgressPercent({phase: "downloading", current: 1, total: 2}),
        ).toBe(5)
        // track 2: 5 + (1 * 45) + (0 * 15) = 50%
        expect(
            getProgressPercent({phase: "downloading", current: 2, total: 2}),
        ).toBe(50)
    })

    it("should calculate progress for uploading phase", () => {
        // 2 tracks: trackSlice=45, phaseSlice=15
        // track 1: 5 + (0 * 45) + (1 * 15) = 20%
        expect(
            getProgressPercent({phase: "uploading", current: 1, total: 2}),
        ).toBe(20)
        // track 2: 5 + (1 * 45) + (1 * 15) = 65%
        expect(
            getProgressPercent({phase: "uploading", current: 2, total: 2}),
        ).toBe(65)
    })

    it("should calculate progress for transcoding phase", () => {
        // 2 tracks: trackSlice=45, phaseSlice=15
        // track 1: 5 + (0 * 45) + (2 * 15) = 35%
        expect(
            getProgressPercent({phase: "transcoding", current: 1, total: 2}),
        ).toBe(35)
        // track 2: 5 + (1 * 45) + (2 * 15) = 80%
        expect(
            getProgressPercent({phase: "transcoding", current: 2, total: 2}),
        ).toBe(80)
    })

    it("should cap progress at 95%", () => {
        // Even with high values, should not exceed 95 (finalizing is 95%)
        expect(
            getProgressPercent({phase: "uploading", current: 10, total: 2}),
        ).toBe(95)
    })

    it("should handle single track imports", () => {
        // 1 track: trackSlice=90, phaseSlice=30
        // downloading: 5 + (0 * 90) + (0 * 30) = 5%
        expect(
            getProgressPercent({phase: "downloading", current: 1, total: 1}),
        ).toBe(5)
        // uploading: 5 + (0 * 90) + (1 * 30) = 35%
        expect(
            getProgressPercent({phase: "uploading", current: 1, total: 1}),
        ).toBe(35)
        // transcoding: 5 + (0 * 90) + (2 * 30) = 65%
        expect(
            getProgressPercent({phase: "transcoding", current: 1, total: 1}),
        ).toBe(65)
    })

    it("should handle multi-track imports with progress through phases", () => {
        // 3 tracks: trackSlice=30, phaseSlice=10
        // downloading track 1: 5 + (0 * 30) + (0 * 10) = 5%
        expect(
            getProgressPercent({phase: "downloading", current: 1, total: 3}),
        ).toBe(5)
        // uploading track 1: 5 + (0 * 30) + (1 * 10) = 15%
        expect(
            getProgressPercent({phase: "uploading", current: 1, total: 3}),
        ).toBe(15)
        // transcoding track 1: 5 + (0 * 30) + (2 * 10) = 25%
        expect(
            getProgressPercent({phase: "transcoding", current: 1, total: 3}),
        ).toBe(25)
        // downloading track 2: 5 + (1 * 30) + (0 * 10) = 35%
        expect(
            getProgressPercent({phase: "downloading", current: 2, total: 3}),
        ).toBe(35)
        // uploading track 2: 5 + (1 * 30) + (1 * 10) = 45%
        expect(
            getProgressPercent({phase: "uploading", current: 2, total: 3}),
        ).toBe(45)
        // transcoding track 2: 5 + (1 * 30) + (2 * 10) = 55%
        expect(
            getProgressPercent({phase: "transcoding", current: 2, total: 3}),
        ).toBe(55)
        // downloading track 3: 5 + (2 * 30) + (0 * 10) = 65%
        expect(
            getProgressPercent({phase: "downloading", current: 3, total: 3}),
        ).toBe(65)
        // uploading track 3: 5 + (2 * 30) + (1 * 10) = 75%
        expect(
            getProgressPercent({phase: "uploading", current: 3, total: 3}),
        ).toBe(75)
        // transcoding track 3: 5 + (2 * 30) + (2 * 10) = 85%
        expect(
            getProgressPercent({phase: "transcoding", current: 3, total: 3}),
        ).toBe(85)
    })
})

describe("stripNullValues", () => {
    it("should return primitive values unchanged", () => {
        expect(stripNullValues("hello")).toBe("hello")
        expect(stripNullValues(42)).toBe(42)
        expect(stripNullValues(true)).toBe(true)
        expect(stripNullValues(false)).toBe(false)
    })

    it("should return null unchanged", () => {
        expect(stripNullValues(null)).toBe(null)
    })

    it("should return undefined unchanged", () => {
        expect(stripNullValues(undefined)).toBe(undefined)
    })

    it("should remove null values from objects", () => {
        const input = {a: 1, b: null, c: "hello"}
        const expected = {a: 1, c: "hello"}
        expect(stripNullValues(input)).toEqual(expected)
    })

    it("should preserve non-null values in objects", () => {
        const input = {a: 1, b: 0, c: "", d: false}
        expect(stripNullValues(input)).toEqual(input)
    })

    it("should handle nested objects", () => {
        const input = {
            a: 1,
            b: {
                c: null,
                d: "value",
                e: {
                    f: null,
                    g: 42,
                },
            },
        }
        const expected = {
            a: 1,
            b: {
                d: "value",
                e: {
                    g: 42,
                },
            },
        }
        expect(stripNullValues(input)).toEqual(expected)
    })

    it("should handle arrays", () => {
        const input = [
            {a: 1, b: null},
            {c: null, d: 2},
        ]
        const expected = [{a: 1}, {d: 2}]
        expect(stripNullValues(input)).toEqual(expected)
    })

    it("should handle arrays with nested objects", () => {
        const input = [
            {
                key: "00",
                title: "Track 1",
                display: null,
                ambient: null,
                tracks: [
                    {
                        key: "01",
                        display: null,
                        title: "Track 1",
                    },
                ],
            },
        ]
        const expected = [
            {
                key: "00",
                title: "Track 1",
                tracks: [
                    {
                        key: "01",
                        title: "Track 1",
                    },
                ],
            },
        ]
        expect(stripNullValues(input)).toEqual(expected)
    })

    it("should handle empty objects", () => {
        expect(stripNullValues({})).toEqual({})
    })

    it("should handle empty arrays", () => {
        expect(stripNullValues([])).toEqual([])
    })

    it("should handle Yoto chapter data with null fields", () => {
        const input = {
            key: "00",
            title: "Me at the zoo",
            tracks: [
                {
                    key: "01",
                    title: "Me at the zoo",
                    format: "opus",
                    trackUrl: "yoto:#abc123",
                    type: "audio",
                    duration: 19,
                    fileSize: 151895,
                    channels: "stereo",
                    display: null,
                    ambient: null,
                },
            ],
            duration: 19,
            fileSize: 151895,
            availableFrom: null,
            display: null,
            ambient: null,
            defaultTrackDisplay: null,
            defaultTrackAmbient: null,
        }
        const expected = {
            key: "00",
            title: "Me at the zoo",
            tracks: [
                {
                    key: "01",
                    title: "Me at the zoo",
                    format: "opus",
                    trackUrl: "yoto:#abc123",
                    type: "audio",
                    duration: 19,
                    fileSize: 151895,
                    channels: "stereo",
                },
            ],
            duration: 19,
            fileSize: 151895,
        }
        expect(stripNullValues(input)).toEqual(expected)
    })
})

describe("createChapter", () => {
    it("should create a chapter with correct structure", () => {
        const chapter = createChapter("Test Track", "abc123hash", 1, 120, 50000)

        expect(chapter).toEqual({
            key: "00",
            title: "Test Track",
            tracks: [
                {
                    key: "01",
                    title: "Test Track",
                    format: "opus",
                    trackUrl: "yoto:#abc123hash",
                    type: "audio",
                    duration: 120,
                    fileSize: 50000,
                    channels: "stereo",
                },
            ],
            duration: 120,
            fileSize: 50000,
        })
    })

    it("should pad chapter key to 2 digits", () => {
        const chapter1 = createChapter("Track 1", "hash1", 1)
        const chapter5 = createChapter("Track 5", "hash5", 5)
        const chapter10 = createChapter("Track 10", "hash10", 10)

        expect(chapter1.key).toBe("00")
        expect(chapter5.key).toBe("04")
        expect(chapter10.key).toBe("09")
    })

    it("should handle optional duration and fileSize", () => {
        const chapter = createChapter("No Duration", "hashvalue", 2)

        expect(chapter.duration).toBeUndefined()
        expect(chapter.fileSize).toBeUndefined()
        expect(chapter.tracks[0].duration).toBeUndefined()
        expect(chapter.tracks[0].fileSize).toBeUndefined()
    })

    it("should always set track key to 01", () => {
        const chapter = createChapter("Track", "hash", 5)
        expect(chapter.tracks[0].key).toBe("01")
    })

    it("should set correct trackUrl format", () => {
        const chapter = createChapter("Track", "mySha256Hash", 1)
        expect(chapter.tracks[0].trackUrl).toBe("yoto:#mySha256Hash")
    })

    it("should set format to opus and type to audio", () => {
        const chapter = createChapter("Track", "hash", 1)
        expect(chapter.tracks[0].format).toBe("opus")
        expect(chapter.tracks[0].type).toBe("audio")
        expect(chapter.tracks[0].channels).toBe("stereo")
    })
})
