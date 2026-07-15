import {
    WorkflowEntrypoint,
    type WorkflowEvent,
    type WorkflowStep,
} from "cloudflare:workers"

import type {Import} from "../app/lib/import"

type ImportWorkflowResult = {
    importId: string
}

class ImportWorkflow extends WorkflowEntrypoint<Env, Import> {
    override async run(
        event: WorkflowEvent<Import>,
        step: WorkflowStep,
    ): Promise<ImportWorkflowResult> {
        return step.do("initialize import", async () => {
            console.info("Import workflow initialized", {
                importId: event.payload.id,
                cardId: event.payload.cardId,
            })

            return {importId: event.payload.id}
        })
    }
}

export {ImportWorkflow}
