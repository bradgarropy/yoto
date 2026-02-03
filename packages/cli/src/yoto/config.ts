import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs"
import {homedir} from "node:os"
import {join} from "node:path"

// Config directory: ~/.config/yoto/
const CONFIG_PATH = join(homedir(), ".config", "yoto")
const PLAYLISTS_FILE = join(CONFIG_PATH, "playlists.json")

type PlaylistAssociation = {
    yotoId: string
    yotoName: string
    youtubeName: string
    lastSynced: string
}

type Playlists = Record<string, PlaylistAssociation>

const ensureConfigDir = (): void => {
    if (!existsSync(CONFIG_PATH)) {
        mkdirSync(CONFIG_PATH, {recursive: true})
    }
}

// Playlist functions
const readPlaylists = (): Playlists => {
    if (!existsSync(PLAYLISTS_FILE)) {
        return {}
    }

    const content = readFileSync(PLAYLISTS_FILE, "utf-8")

    try {
        return JSON.parse(content) as Playlists
    } catch {
        throw new Error(
            "Corrupted playlists file: ~/.config/yoto/playlists.json",
        )
    }
}

const writePlaylists = (playlists: Playlists): void => {
    ensureConfigDir()
    writeFileSync(PLAYLISTS_FILE, JSON.stringify(playlists, null, 4))
}

const getPlaylistAssociation = (
    youtubePlaylistId: string,
): PlaylistAssociation | null => {
    const playlists = readPlaylists()
    return playlists[youtubePlaylistId] ?? null
}

const setPlaylistAssociation = (
    youtubePlaylistId: string,
    association: PlaylistAssociation,
): void => {
    const playlists = readPlaylists()
    playlists[youtubePlaylistId] = association
    writePlaylists(playlists)
}

export {
    CONFIG_PATH,
    ensureConfigDir,
    getPlaylistAssociation,
    PLAYLISTS_FILE,
    readPlaylists,
    setPlaylistAssociation,
    writePlaylists,
}

export type {PlaylistAssociation, Playlists}
