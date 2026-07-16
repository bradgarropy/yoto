import {
    WorkflowEntrypoint,
    type WorkflowEvent,
    type WorkflowStep,
} from "cloudflare:workers"

import {getYotoSdk} from "~/lib/auth.server"
import {
    getImportSandboxId,
    type ImportWorkflowParams,
    type ImportWorkflowResult,
} from "~/lib/import"
import {performImportToCard} from "~/lib/import.server"
import {readImportCredential} from "~/lib/import-credential.server"
import {destroySandbox} from "~/lib/sandbox.server"

class ImportWorkflow extends WorkflowEntrypoint<Env, ImportWorkflowParams> {
    override async run(
        event: WorkflowEvent<ImportWorkflowParams>,
        step: WorkflowStep,
    ): Promise<ImportWorkflowResult> {
        const {credential, ...cardImport} = event.payload
        const sandboxId = getImportSandboxId(cardImport)
        const progress = this.env.IMPORT_PROGRESS.getByName(cardImport.id)

        const result = await step.do(
            "import tracks",
            {
                retries: {limit: 0, delay: 0},
                timeout: "30 minutes",
            },
            async () => {
                const token = await readImportCredential(credential, this.env)
                const sdk = getYotoSdk(token)

                console.info("Import workflow started", {
                    importId: cardImport.id,
                    sandboxId,
                    cardId: cardImport.cardId,
                })

                try {
                    const importResult = await performImportToCard(
                        sdk,
                        this.env,
                        cardImport,
                        update => progress.reportProgress(update),
                    )

                    if ("error" in importResult) {
                        throw new Error(importResult.error)
                    }

                    const result = {
                        status: "success" as const,
                        message: importResult.message,
                        added: importResult.added,
                        skipped: importResult.skipped,
                    }

                    await progress.reportComplete(result)
                    return result
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : "Import failed unexpectedly"
                    await progress.reportError(message)
                    throw error
                } finally {
                    try {
                        await destroySandbox(this.env, sandboxId)
                        console.info("Import sandbox destroyed", {
                            importId: cardImport.id,
                            sandboxId,
                            cardId: cardImport.cardId,
                        })
                    } catch (error) {
                        console.warn("Failed to destroy import sandbox", {
                            importId: cardImport.id,
                            sandboxId,
                            cardId: cardImport.cardId,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        })
                    }
                }
            },
        )

        return {
            importId: cardImport.id,
            ...result,
        }
    }
}

export {ImportWorkflow}
