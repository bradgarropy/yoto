import {
    existsSync,
    mkdirSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from "node:fs"
import {homedir} from "node:os"
import {join} from "node:path"

// Config directory: ~/.config/yoto/
const CONFIG_PATH = join(homedir(), ".config", "yoto")
const AUTH_FILE = join(CONFIG_PATH, "auth.json")
const PLAYLISTS_FILE = join(CONFIG_PATH, "playlists.json")

type Auth = {
    accessToken: string
    expiresAt: number
}

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

// Auth functions
const readAuth = (): Auth | null => {
    if (!existsSync(AUTH_FILE)) {
        return null
    }

    const content = readFileSync(AUTH_FILE, "utf-8")
    return JSON.parse(content) as Auth
}

const writeAuth = (auth: Auth): void => {
    ensureConfigDir()
    writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 4))
}

const deleteAuth = (): void => {
    if (existsSync(AUTH_FILE)) {
        unlinkSync(AUTH_FILE)
    }
}

// Playlist functions
const readPlaylists = (): Playlists => {
    if (!existsSync(PLAYLISTS_FILE)) {
        return {}
    }

    const content = readFileSync(PLAYLISTS_FILE, "utf-8")
    return JSON.parse(content) as Playlists
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
    AUTH_FILE,
    CONFIG_PATH,
    PLAYLISTS_FILE,
    deleteAuth,
    getPlaylistAssociation,
    readAuth,
    readPlaylists,
    setPlaylistAssociation,
    writeAuth,
    writePlaylists,
}

export type {Auth, PlaylistAssociation, Playlists}
