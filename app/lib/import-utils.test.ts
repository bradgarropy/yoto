import {describe, expect, it} from "vitest"

import {
    createChapter,
    getImportProgressSummary,
    getNextChapterKey,
    getProgressPercent,
    stripNullValues,
} from "./import-utils"

describe("getImportProgressSummary", () => {
    it("should report inspection progress before track work begins", () => {
        expect(
            getImportProgressSummary({
                inspected: true,
                tracks: [
                    {
                        duration: 180,
                        prepared: false,
                        uploaded: false,
                        ready: false,
                    },
                ],
                cardUpdated: false,
            }),
        ).toEqual({
            percent: 5,
            total: 1,
            prepared: 0,
            uploaded: 0,
            ready: 0,
        })
    })

    it("should weight completed work by track duration", () => {
        expect(
            getImportProgressSummary({
                inspected: true,
                tracks: [
                    {
                        duration: 60,
                        prepared: true,
                        uploaded: true,
                        ready: true,
                    },
                    {
                        duration: 180,
                        prepared: false,
                        uploaded: false,
                        ready: false,
                    },
                ],
                cardUpdated: false,
            }),
        ).toEqual({
            percent: 28,
            total: 2,
            prepared: 1,
            uploaded: 1,
            ready: 1,
        })
    })

    it("should use the average known duration for tracks without metadata", () => {
        expect(
            getImportProgressSummary({
                inspected: true,
                tracks: [
                    {
                        duration: 60,
                        prepared: true,
                        uploaded: false,
                        ready: false,
                    },
                    {
                        prepared: false,
                        uploaded: false,
                        ready: false,
                    },
                ],
                cardUpdated: false,
            }).percent,
        ).toBe(20)
    })

    it("should report 95% when every track is ready", () => {
        expect(
            getImportProgressSummary({
                inspected: true,
                tracks: [
                    {
                        prepared: true,
                        uploaded: true,
                        ready: true,
                    },
                    {
                        prepared: true,
                        uploaded: true,
                        ready: true,
                    },
                ],
                cardUpdated: false,
            }),
        ).toEqual({
            percent: 95,
            total: 2,
            prepared: 2,
            uploaded: 2,
            ready: 2,
        })
    })

    it("should report 100% after the card is updated", () => {
        expect(
            getImportProgressSummary({
                inspected: true,
                tracks: [
                    {
                        prepared: true,
                        uploaded: true,
                        ready: true,
                    },
                ],
                cardUpdated: true,
            }).percent,
        ).toBe(100)
    })
})

describe("getProgressPercent", () => {
    it("should return 0 when progress is null", () => {
        expect(getProgressPercent(null)).toBe(0)
    })

    it("should return the reported percentage", () => {
        expect(
            getProgressPercent({
                phase: "importing",
                percent: 64,
                total: 3,
                prepared: 3,
                uploaded: 2,
                ready: 1,
            }),
        ).toBe(64)
    })

    it("should return finalizing progress", () => {
        expect(
            getProgressPercent({
                phase: "finalizing",
                percent: 95,
                total: 1,
                prepared: 1,
                uploaded: 1,
                ready: 1,
            }),
        ).toBe(95)
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

describe("getNextChapterKey", () => {
    it("should return '00' for an empty array", () => {
        expect(getNextChapterKey([])).toBe("00")
    })

    it("should return next key for sequential chapters", () => {
        const chapters = [{key: "00"}, {key: "01"}, {key: "02"}]
        expect(getNextChapterKey(chapters)).toBe("03")
    })

    it("should handle gaps from deleted chapters", () => {
        const chapters = [{key: "00"}, {key: "02"}]
        expect(getNextChapterKey(chapters)).toBe("03")
    })

    it("should handle a single chapter", () => {
        expect(getNextChapterKey([{key: "05"}])).toBe("06")
    })

    it("should handle chapters with undefined keys", () => {
        const chapters = [{key: undefined}, {key: "03"}]
        expect(getNextChapterKey(chapters)).toBe("04")
    })

    it("should pad single-digit keys with leading zero", () => {
        const chapters = [{key: "08"}]
        expect(getNextChapterKey(chapters)).toBe("09")
    })

    it("should handle double-digit keys", () => {
        const chapters = [{key: "10"}, {key: "11"}]
        expect(getNextChapterKey(chapters)).toBe("12")
    })
})
