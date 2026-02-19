import {describe, expect, it} from "vitest"

import {createChapter, getProgressPercent, stripNullValues} from "./sync-utils"

describe("getProgressPercent", () => {
    it("should return 0 when progress is null", () => {
        expect(getProgressPercent(null)).toBe(0)
    })

    it("should return 0 for preparing phase", () => {
        expect(getProgressPercent({phase: "preparing"})).toBe(0)
    })

    it("should return 95 for finalizing phase", () => {
        expect(getProgressPercent({phase: "finalizing"})).toBe(95)
    })

    it("should return phase start for phases without counts", () => {
        expect(getProgressPercent({phase: "downloading"})).toBe(5)
        expect(getProgressPercent({phase: "uploading"})).toBe(35)
        expect(getProgressPercent({phase: "transcoding"})).toBe(65)
    })

    it("should calculate progress for downloading phase (5-35%)", () => {
        // current is 1-indexed (track currently in progress)
        // Formula: phaseStart + ((current - 1) / total) * phaseSize
        // downloading 1/2: 5 + ((1-1)/2) * 30 = 5 + 0 = 5%
        expect(
            getProgressPercent({phase: "downloading", current: 1, total: 2}),
        ).toBe(5)
        // downloading 2/2: 5 + ((2-1)/2) * 30 = 5 + 15 = 20%
        expect(
            getProgressPercent({phase: "downloading", current: 2, total: 2}),
        ).toBe(20)
    })

    it("should calculate progress for uploading phase (35-65%)", () => {
        // uploading 1/2: 35 + ((1-1)/2) * 30 = 35 + 0 = 35%
        expect(
            getProgressPercent({phase: "uploading", current: 1, total: 2}),
        ).toBe(35)
        // uploading 2/2: 35 + ((2-1)/2) * 30 = 35 + 15 = 50%
        expect(
            getProgressPercent({phase: "uploading", current: 2, total: 2}),
        ).toBe(50)
    })

    it("should calculate progress for transcoding phase (65-95%)", () => {
        // transcoding 1/2: 65 + ((1-1)/2) * 30 = 65 + 0 = 65%
        expect(
            getProgressPercent({phase: "transcoding", current: 1, total: 2}),
        ).toBe(65)
        // transcoding 2/2: 65 + ((2-1)/2) * 30 = 65 + 15 = 80%
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
        // Single track: current=1, total=1
        // downloading 1/1: 5 + ((1-1)/1) * 30 = 5%
        expect(
            getProgressPercent({phase: "downloading", current: 1, total: 1}),
        ).toBe(5)
        // uploading 1/1: 35 + ((1-1)/1) * 30 = 35%
        expect(
            getProgressPercent({phase: "uploading", current: 1, total: 1}),
        ).toBe(35)
        // transcoding 1/1: 65 + ((1-1)/1) * 30 = 65%
        expect(
            getProgressPercent({phase: "transcoding", current: 1, total: 1}),
        ).toBe(65)
    })

    it("should handle multi-track imports with progress through phases", () => {
        // 3 tracks - current indicates which track is in progress (1-indexed)
        // Formula: phaseStart + ((current - 1) / total) * phaseSize

        // Download phase (5-35%)
        // downloading 1/3: 5 + ((1-1)/3) * 30 = 5 + 0 = 5%
        expect(
            getProgressPercent({phase: "downloading", current: 1, total: 3}),
        ).toBe(5)
        // downloading 2/3: 5 + ((2-1)/3) * 30 = 5 + 10 = 15%
        expect(
            getProgressPercent({phase: "downloading", current: 2, total: 3}),
        ).toBe(15)
        // downloading 3/3: 5 + ((3-1)/3) * 30 = 5 + 20 = 25%
        expect(
            getProgressPercent({phase: "downloading", current: 3, total: 3}),
        ).toBe(25)

        // Upload phase (35-65%)
        // uploading 1/3: 35 + ((1-1)/3) * 30 = 35 + 0 = 35%
        expect(
            getProgressPercent({phase: "uploading", current: 1, total: 3}),
        ).toBe(35)
        // uploading 2/3: 35 + ((2-1)/3) * 30 = 35 + 10 = 45%
        expect(
            getProgressPercent({phase: "uploading", current: 2, total: 3}),
        ).toBe(45)
        // uploading 3/3: 35 + ((3-1)/3) * 30 = 35 + 20 = 55%
        expect(
            getProgressPercent({phase: "uploading", current: 3, total: 3}),
        ).toBe(55)

        // Transcode phase (65-95%)
        // transcoding 1/3: 65 + ((1-1)/3) * 30 = 65 + 0 = 65%
        expect(
            getProgressPercent({phase: "transcoding", current: 1, total: 3}),
        ).toBe(65)
        // transcoding 2/3: 65 + ((2-1)/3) * 30 = 65 + 10 = 75%
        expect(
            getProgressPercent({phase: "transcoding", current: 2, total: 3}),
        ).toBe(75)
        // transcoding 3/3: 65 + ((3-1)/3) * 30 = 65 + 20 = 85%
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
