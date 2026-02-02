import {vol} from "memfs"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import type {Auth, Playlists} from "~/yoto/config"
import {
    AUTH_FILE,
    deleteAuth,
    getPlaylistAssociation,
    PLAYLISTS_FILE,
    readAuth,
    readPlaylists,
    setPlaylistAssociation,
    writeAuth,
    writePlaylists,
} from "~/yoto/config"

// Mock node:fs with memfs
vi.mock("node:fs", async () => {
    const memfs = await import("memfs")
    return memfs.fs
})

// Mock homedir to return a predictable path
vi.mock("node:os", () => ({
    homedir: () => "/home/testuser",
}))

beforeEach(() => {
    vol.reset()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("auth functions", () => {
    it("writeAuth and readAuth should work together", () => {
        const auth: Auth = {
            accessToken: "test-token-123",
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
        }

        writeAuth(auth)
        const result = readAuth()

        expect(result).toEqual(auth)
    })

    it("deleteAuth should remove the auth file", () => {
        const auth: Auth = {
            accessToken: "test-token-456",
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
        }

        writeAuth(auth)
        expect(readAuth()).toEqual(auth)

        deleteAuth()

        expect(readAuth()).toBeNull()
    })

    it("deleteAuth should not throw when file does not exist", () => {
        expect(() => deleteAuth()).not.toThrow()
    })

    it("readAuth should return null when no auth file exists", () => {
        expect(readAuth()).toBeNull()
    })

    it("readAuth should throw on corrupted JSON", () => {
        vol.fromJSON({
            [AUTH_FILE]: "not valid json {{{",
        })

        expect(() => readAuth()).toThrow("Corrupted auth file")
    })
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
