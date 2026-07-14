import {
    WorkflowEntrypoint,
    type WorkflowEvent,
    type WorkflowStep,
} from "cloudflare:workers"

import type {Upload} from "../app/lib/upload"

type UploadWorkflowResult = {
    uploadId: string
}

class UploadWorkflow extends WorkflowEntrypoint<Env, Upload> {
    override async run(
        event: WorkflowEvent<Upload>,
        step: WorkflowStep,
    ): Promise<UploadWorkflowResult> {
        return step.do("initialize upload", async () => {
            console.info("Upload workflow initialized", {
                uploadId: event.payload.id,
                cardId: event.payload.cardId,
            })

            return {uploadId: event.payload.id}
        })
    }
}

export {UploadWorkflow}
