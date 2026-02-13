import {existsSync, mkdirSync} from "node:fs"
import {homedir} from "node:os"
import {join} from "node:path"

// Config directory: ~/.config/yoto/
const CONFIG_PATH = join(homedir(), ".config", "yoto")

const ensureConfigDir = (): void => {
    if (!existsSync(CONFIG_PATH)) {
        mkdirSync(CONFIG_PATH, {recursive: true})
    }
}

export {CONFIG_PATH, ensureConfigDir}
