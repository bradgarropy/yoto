import {DurableObject} from "cloudflare:workers"

import type {ImportProgress as ImportProgressState} from "~/lib/import-utils"

class ImportProgress extends DurableObject<Env> {
    async reportProgress(progress: ImportProgressState): Promise<void> {
        await this.ctx.storage.put("progress", progress)
    }

    async getProgress(): Promise<ImportProgressState | null> {
        const progress =
            await this.ctx.storage.get<ImportProgressState>("progress")

        if (!progress) {
            return null
        }

        return progress
    }
}

export {ImportProgress}
