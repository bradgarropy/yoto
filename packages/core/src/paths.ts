import {existsSync, mkdirSync} from "node:fs"
import {homedir} from "node:os"
import {join} from "node:path"

// Config directory: ~/.config/yoto/
const CONFIG_PATH = join(homedir(), ".config", "yoto")
const PLAYLISTS_FILE = join(CONFIG_PATH, "playlists.json")
const TRACKS_FILE = join(CONFIG_PATH, "tracks.json")

const ensureConfigDir = (): void => {
    if (!existsSync(CONFIG_PATH)) {
        mkdirSync(CONFIG_PATH, {recursive: true})
    }
}

export {CONFIG_PATH, ensureConfigDir, PLAYLISTS_FILE, TRACKS_FILE}
