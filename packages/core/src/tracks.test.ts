import {vol} from "memfs"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import type {CardTracks, SyncedTrack, Tracks} from "./tracks.js"
import {
    addSyncedTrack,
    getCardTracks,
    getSyncedVideoIds,
    isVideoSynced,
    readTracks,
    removeCardTracks,
    removeSyncedTrack,
    setCardTracks,
    writeTracks,
} from "./tracks.js"

// Mock node:fs with memfs
vi.mock("node:fs", async () => {
    const memfs = await import("memfs")
    return memfs.fs
})

// Mock homedir to return a predictable path
vi.mock("node:os", () => ({
    homedir: () => "/home/testuser",
}))

const TRACKS_FILE = "/home/testuser/.config/yoto/tracks.json"

beforeEach(() => {
    vol.reset()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("tracks functions", () => {
    it("writeTracks and readTracks should work together", () => {
        const tracks: Tracks = {
            card123: {
                videos: [
                    {
                        youtubeVideoId: "abc123",
                        title: "Test Video",
                        syncedAt: "2026-02-03T12:00:00Z",
                        yotoTrackKey: "track-key-1",
                    },
                ],
                youtubePlaylistId: "PLtest",
                lastSynced: "2026-02-03T12:00:00Z",
            },
        }

        writeTracks(tracks)
        const result = readTracks()

        expect(result).toEqual(tracks)
    })

    it("readTracks should return empty object when no file exists", () => {
        const result = readTracks()
        expect(result).toEqual({})
    })

    it("readTracks should throw on corrupted JSON", () => {
        vol.fromJSON({
            [TRACKS_FILE]: "not valid json {{{",
        })

        expect(() => readTracks()).toThrow("Corrupted tracks file")
    })

    it("getCardTracks should return tracks when card exists", () => {
        const cardTracks: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "video1",
                    title: "First Video",
                    syncedAt: "2026-02-03T12:00:00Z",
                    yotoTrackKey: "key1",
                },
            ],
            lastSynced: "2026-02-03T12:00:00Z",
        }

        writeTracks({card456: cardTracks})

        const result = getCardTracks("card456")
        expect(result).toEqual(cardTracks)
    })

    it("getCardTracks should return null when card does not exist", () => {
        writeTracks({})

        const result = getCardTracks("nonexistent")
        expect(result).toBeNull()
    })

    it("setCardTracks should add new card tracks", () => {
        writeTracks({})

        const cardTracks: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "newvideo",
                    title: "New Video",
                    syncedAt: "2026-02-03T13:00:00Z",
                    yotoTrackKey: "newkey",
                },
            ],
            lastSynced: "2026-02-03T13:00:00Z",
        }

        setCardTracks("newcard", cardTracks)

        const tracks = readTracks()
        expect(tracks.newcard).toEqual(cardTracks)
    })

    it("setCardTracks should update existing card tracks", () => {
        const original: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "old",
                    title: "Old",
                    syncedAt: "2026-01-01T00:00:00Z",
                    yotoTrackKey: "oldkey",
                },
            ],
            lastSynced: "2026-01-01T00:00:00Z",
        }

        writeTracks({updatecard: original})

        const updated: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "old",
                    title: "Old",
                    syncedAt: "2026-01-01T00:00:00Z",
                    yotoTrackKey: "oldkey",
                },
                {
                    youtubeVideoId: "new",
                    title: "New",
                    syncedAt: "2026-02-03T14:00:00Z",
                    yotoTrackKey: "newkey",
                },
            ],
            lastSynced: "2026-02-03T14:00:00Z",
        }

        setCardTracks("updatecard", updated)

        const tracks = readTracks()
        expect(tracks.updatecard).toEqual(updated)
    })

    it("isVideoSynced should return true when video exists", () => {
        const cardTracks: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "existingvideo",
                    title: "Existing",
                    syncedAt: "2026-02-03T12:00:00Z",
                    yotoTrackKey: "key",
                },
            ],
            lastSynced: "2026-02-03T12:00:00Z",
        }

        writeTracks({checkcard: cardTracks})

        expect(isVideoSynced("checkcard", "existingvideo")).toBe(true)
    })

    it("isVideoSynced should return false when video does not exist", () => {
        const cardTracks: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "othervideo",
                    title: "Other",
                    syncedAt: "2026-02-03T12:00:00Z",
                    yotoTrackKey: "key",
                },
            ],
            lastSynced: "2026-02-03T12:00:00Z",
        }

        writeTracks({checkcard: cardTracks})

        expect(isVideoSynced("checkcard", "notexisting")).toBe(false)
    })

    it("isVideoSynced should return false when card does not exist", () => {
        writeTracks({})

        expect(isVideoSynced("nocard", "somevideo")).toBe(false)
    })

    it("addSyncedTrack should add track to existing card", () => {
        const cardTracks: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "first",
                    title: "First",
                    syncedAt: "2026-02-03T12:00:00Z",
                    yotoTrackKey: "key1",
                },
            ],
            lastSynced: "2026-02-03T12:00:00Z",
        }

        writeTracks({addcard: cardTracks})

        const newTrack: SyncedTrack = {
            youtubeVideoId: "second",
            title: "Second",
            syncedAt: "2026-02-03T13:00:00Z",
            yotoTrackKey: "key2",
        }

        addSyncedTrack("addcard", newTrack)

        const result = getCardTracks("addcard")
        expect(result?.videos).toHaveLength(2)
        expect(result?.videos[1]).toEqual(newTrack)
        expect(result?.lastSynced).toBe("2026-02-03T13:00:00Z")
    })

    it("addSyncedTrack should create card if it does not exist", () => {
        writeTracks({})

        const track: SyncedTrack = {
            youtubeVideoId: "newvideo",
            title: "New Video",
            syncedAt: "2026-02-03T14:00:00Z",
            yotoTrackKey: "newkey",
        }

        addSyncedTrack("brandnewcard", track)

        const result = getCardTracks("brandnewcard")
        expect(result?.videos).toHaveLength(1)
        expect(result?.videos[0]).toEqual(track)
    })

    it("addSyncedTrack should not add duplicate video", () => {
        const cardTracks: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "duplicate",
                    title: "Original",
                    syncedAt: "2026-02-03T12:00:00Z",
                    yotoTrackKey: "key1",
                },
            ],
            lastSynced: "2026-02-03T12:00:00Z",
        }

        writeTracks({dupcard: cardTracks})

        const duplicateTrack: SyncedTrack = {
            youtubeVideoId: "duplicate",
            title: "Duplicate Attempt",
            syncedAt: "2026-02-03T15:00:00Z",
            yotoTrackKey: "key2",
        }

        addSyncedTrack("dupcard", duplicateTrack)

        const result = getCardTracks("dupcard")
        expect(result?.videos).toHaveLength(1)
        expect(result?.videos[0].title).toBe("Original")
    })

    it("getSyncedVideoIds should return set of video IDs", () => {
        const cardTracks: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "vid1",
                    title: "Video 1",
                    syncedAt: "2026-02-03T12:00:00Z",
                    yotoTrackKey: "key1",
                },
                {
                    youtubeVideoId: "vid2",
                    title: "Video 2",
                    syncedAt: "2026-02-03T12:01:00Z",
                    yotoTrackKey: "key2",
                },
                {
                    youtubeVideoId: "vid3",
                    title: "Video 3",
                    syncedAt: "2026-02-03T12:02:00Z",
                    yotoTrackKey: "key3",
                },
            ],
            lastSynced: "2026-02-03T12:02:00Z",
        }

        writeTracks({setcard: cardTracks})

        const result = getSyncedVideoIds("setcard")
        expect(result).toEqual(new Set(["vid1", "vid2", "vid3"]))
    })

    it("getSyncedVideoIds should return empty set when card does not exist", () => {
        writeTracks({})

        const result = getSyncedVideoIds("nocard")
        expect(result).toEqual(new Set())
    })

    it("removeCardTracks should remove card from tracks", () => {
        const tracks: Tracks = {
            card1: {
                videos: [
                    {
                        youtubeVideoId: "vid1",
                        title: "Video 1",
                        syncedAt: "2026-02-03T12:00:00Z",
                        yotoTrackKey: "key1",
                    },
                ],
                lastSynced: "2026-02-03T12:00:00Z",
            },
            card2: {
                videos: [
                    {
                        youtubeVideoId: "vid2",
                        title: "Video 2",
                        syncedAt: "2026-02-03T13:00:00Z",
                        yotoTrackKey: "key2",
                    },
                ],
                lastSynced: "2026-02-03T13:00:00Z",
            },
        }

        writeTracks(tracks)

        removeCardTracks("card1")

        const result = readTracks()
        expect(result.card1).toBeUndefined()
        expect(result.card2).toBeDefined()
    })

    it("removeCardTracks should handle non-existent card gracefully", () => {
        const tracks: Tracks = {
            existingcard: {
                videos: [
                    {
                        youtubeVideoId: "vid1",
                        title: "Video 1",
                        syncedAt: "2026-02-03T12:00:00Z",
                        yotoTrackKey: "key1",
                    },
                ],
                lastSynced: "2026-02-03T12:00:00Z",
            },
        }

        writeTracks(tracks)

        // Should not throw
        removeCardTracks("nonexistent")

        const result = readTracks()
        expect(result.existingcard).toBeDefined()
    })

    it("removeCardTracks should persist changes to file", () => {
        const cardTracks: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "vid1",
                    title: "Video 1",
                    syncedAt: "2026-02-03T12:00:00Z",
                    yotoTrackKey: "key1",
                },
            ],
            lastSynced: "2026-02-03T12:00:00Z",
        }

        writeTracks({cardToRemove: cardTracks})

        // Verify card exists
        expect(getCardTracks("cardToRemove")).not.toBeNull()

        removeCardTracks("cardToRemove")

        // Verify card is removed and change is persisted
        expect(getCardTracks("cardToRemove")).toBeNull()
    })

    it("removeSyncedTrack should remove a single track by yotoTrackKey", () => {
        const cardTracks: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "vid1",
                    title: "Video 1",
                    syncedAt: "2026-02-03T12:00:00Z",
                    yotoTrackKey: "key1",
                },
                {
                    youtubeVideoId: "vid2",
                    title: "Video 2",
                    syncedAt: "2026-02-03T12:01:00Z",
                    yotoTrackKey: "key2",
                },
                {
                    youtubeVideoId: "vid3",
                    title: "Video 3",
                    syncedAt: "2026-02-03T12:02:00Z",
                    yotoTrackKey: "key3",
                },
            ],
            lastSynced: "2026-02-03T12:02:00Z",
        }

        writeTracks({removetrack: cardTracks})

        removeSyncedTrack("removetrack", "key2")

        const result = getCardTracks("removetrack")
        expect(result?.videos).toHaveLength(2)
        expect(result?.videos.map(v => v.yotoTrackKey)).toEqual([
            "key1",
            "key3",
        ])
    })

    it("removeSyncedTrack should delete card entry when last track is removed", () => {
        const cardTracks: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "vid1",
                    title: "Video 1",
                    syncedAt: "2026-02-03T12:00:00Z",
                    yotoTrackKey: "key1",
                },
            ],
            lastSynced: "2026-02-03T12:00:00Z",
        }

        writeTracks({singletrack: cardTracks})

        removeSyncedTrack("singletrack", "key1")

        const result = getCardTracks("singletrack")
        expect(result).toBeNull()
    })

    it("removeSyncedTrack should handle non-existent card gracefully", () => {
        writeTracks({})

        // Should not throw
        removeSyncedTrack("nonexistent", "key1")

        const result = readTracks()
        expect(result).toEqual({})
    })

    it("removeSyncedTrack should handle non-existent track gracefully", () => {
        const cardTracks: CardTracks = {
            videos: [
                {
                    youtubeVideoId: "vid1",
                    title: "Video 1",
                    syncedAt: "2026-02-03T12:00:00Z",
                    yotoTrackKey: "key1",
                },
            ],
            lastSynced: "2026-02-03T12:00:00Z",
        }

        writeTracks({existingcard: cardTracks})

        // Should not throw
        removeSyncedTrack("existingcard", "nonexistent-key")

        const result = getCardTracks("existingcard")
        expect(result?.videos).toHaveLength(1)
    })
})
