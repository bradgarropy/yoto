import {vol} from "memfs"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import type {Playlists} from "./playlists.js"
import {
    getPlaylistAssociation,
    readPlaylists,
    setPlaylistAssociation,
    writePlaylists,
} from "./playlists.js"

// Mock node:fs with memfs
vi.mock("node:fs", async () => {
    const memfs = await import("memfs")
    return memfs.fs
})

// Mock homedir to return a predictable path
vi.mock("node:os", () => ({
    homedir: () => "/home/testuser",
}))

const PLAYLISTS_FILE = "/home/testuser/.config/yoto/playlists.json"

beforeEach(() => {
    vol.reset()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("playlist functions", () => {
    it("writePlaylists and readPlaylists should work together", () => {
        const playlists: Playlists = {
            PLtest123: {
                yotoId: "yoto-abc",
                yotoName: "Test Playlist",
                youtubeName: "YouTube Test",
                lastSynced: "2026-01-01T00:00:00Z",
            },
        }

        writePlaylists(playlists)
        const result = readPlaylists()

        expect(result).toEqual(playlists)
    })

    it("readPlaylists should return empty object when no file exists", () => {
        const result = readPlaylists()
        expect(result).toEqual({})
    })

    it("getPlaylistAssociation should return association when exists", () => {
        const association = {
            yotoId: "yoto-xyz",
            yotoName: "My Playlist",
            youtubeName: "YT Playlist",
            lastSynced: "2026-02-01T12:00:00Z",
        }

        writePlaylists({PLexample: association})

        const result = getPlaylistAssociation("PLexample")
        expect(result).toEqual(association)
    })

    it("getPlaylistAssociation should return null when not exists", () => {
        writePlaylists({})

        const result = getPlaylistAssociation("PLnonexistent")
        expect(result).toBeNull()
    })

    it("setPlaylistAssociation should add new association", () => {
        writePlaylists({})

        const association = {
            yotoId: "yoto-new",
            yotoName: "New Playlist",
            youtubeName: "New YT Playlist",
            lastSynced: "2026-02-02T00:00:00Z",
        }

        setPlaylistAssociation("PLnew123", association)

        const playlists = readPlaylists()
        expect(playlists.PLnew123).toEqual(association)
    })

    it("setPlaylistAssociation should update existing association", () => {
        const original = {
            yotoId: "yoto-orig",
            yotoName: "Original",
            youtubeName: "Original YT",
            lastSynced: "2026-01-01T00:00:00Z",
        }

        writePlaylists({PLupdate: original})

        const updated = {
            yotoId: "yoto-orig",
            yotoName: "Updated",
            youtubeName: "Updated YT",
            lastSynced: "2026-02-02T00:00:00Z",
        }

        setPlaylistAssociation("PLupdate", updated)

        const playlists = readPlaylists()
        expect(playlists.PLupdate).toEqual(updated)
    })

    it("readPlaylists should throw on corrupted JSON", () => {
        vol.fromJSON({
            [PLAYLISTS_FILE]: "not valid json {{{",
        })

        expect(() => readPlaylists()).toThrow("Corrupted playlists file")
    })
})
