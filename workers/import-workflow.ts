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
                    )

                    if ("error" in importResult) {
                        throw new Error(importResult.error)
                    }

                    return {
                        status: "success" as const,
                        message: importResult.message,
                        added: importResult.added,
                        skipped: importResult.skipped,
                    }
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
