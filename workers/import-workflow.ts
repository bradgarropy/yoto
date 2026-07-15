import {
    WorkflowEntrypoint,
    type WorkflowEvent,
    type WorkflowStep,
} from "cloudflare:workers"

import {getYotoSdk} from "~/lib/auth.server"
import {
    IMPORT_EVENT,
    type ImportResult,
    type ImportWorkflowParams,
} from "~/lib/import"
import {readImportCredential} from "~/lib/import-credential.server"

type ImportWorkflowResult = {
    importId: string
} & Extract<ImportResult, {status: "success"}>

class ImportWorkflow extends WorkflowEntrypoint<Env, ImportWorkflowParams> {
    override async run(
        event: WorkflowEvent<ImportWorkflowParams>,
        step: WorkflowStep,
    ): Promise<ImportWorkflowResult> {
        await step.do("initialize import", async () => {
            const token = await readImportCredential(
                event.payload.credential,
                this.env,
            )
            getYotoSdk(token)

            console.info("Import workflow initialized", {
                importId: event.payload.id,
                cardId: event.payload.cardId,
            })
        })

        const finishedEvent = await step.waitForEvent<ImportResult>(
            "wait for import result",
            {
                type: IMPORT_EVENT.COMPLETE,
                timeout: "1 hour",
            },
        )

        if (finishedEvent.payload.status === "error") {
            throw new Error(finishedEvent.payload.error)
        }

        return {
            importId: event.payload.id,
            ...finishedEvent.payload,
        }
    }
}

export {ImportWorkflow}
