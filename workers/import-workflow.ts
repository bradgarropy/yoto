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
import {
    importVideo,
    inspectVideo,
    transcodeAudio,
    updateCard,
} from "~/lib/import.server"
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

        console.info("Import workflow started", {
            importId: cardImport.id,
            sandboxId,
            cardId: cardImport.cardId,
        })

        const getSdk = async () => {
            const token = await readImportCredential(credential, this.env)
            return getYotoSdk(token)
        }
        const reportProgress = (
            update: Parameters<typeof progress.reportProgress>[0],
        ) => progress.reportProgress(update)

        try {
            const tracks = await step.do(
                "inspect video",
                {
                    retries: {
                        limit: 3,
                        delay: "5 seconds",
                        backoff: "exponential",
                    },
                    timeout: "5 minutes",
                },
                () => inspectVideo(this.env, cardImport, reportProgress),
            )
            const chapterSplitUnavailable =
                cardImport.splitByChapters &&
                tracks.every(track => !track.chapters?.length)

            const importedTracks = await step.do(
                "import video",
                {
                    retries: {
                        limit: 3,
                        delay: "10 seconds",
                        backoff: "exponential",
                    },
                    timeout: "30 minutes",
                },
                async () => {
                    const sdk = await getSdk()
                    return importVideo(
                        sdk,
                        this.env,
                        cardImport,
                        tracks,
                        reportProgress,
                    )
                },
            )

            const transcodedTracks = await step.do(
                "transcode audio",
                {
                    retries: {
                        limit: 3,
                        delay: "10 seconds",
                        backoff: "exponential",
                    },
                    timeout: "30 minutes",
                },
                async () => {
                    const sdk = await getSdk()
                    return transcodeAudio(
                        sdk,
                        cardImport.cardId,
                        importedTracks,
                        reportProgress,
                    )
                },
            )

            const result = await step.do(
                "update card",
                {
                    retries: {limit: 0, delay: 0},
                    timeout: "5 minutes",
                },
                async () => {
                    const sdk = await getSdk()
                    return updateCard(
                        sdk,
                        cardImport.cardId,
                        transcodedTracks,
                        reportProgress,
                    )
                },
            )

            const completedResult = chapterSplitUnavailable
                ? {
                      ...result,
                      description:
                          "No YouTube chapters were found, so the video was added as a single track.",
                  }
                : result

            await progress.reportComplete(completedResult)

            return {
                importId: cardImport.id,
                ...completedResult,
            }
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Import failed unexpectedly"
            await progress.reportError(message)
            throw error
        } finally {
            try {
                await step.do(
                    "cleanup sandbox",
                    {
                        retries: {
                            limit: 3,
                            delay: "5 seconds",
                            backoff: "exponential",
                        },
                        timeout: "5 minutes",
                    },
                    async () => {
                        await destroySandbox(this.env, sandboxId)
                        console.info("Import sandbox destroyed", {
                            importId: cardImport.id,
                            sandboxId,
                            cardId: cardImport.cardId,
                        })
                    },
                )
            } catch (error) {
                console.warn("Failed to destroy import sandbox", {
                    importId: cardImport.id,
                    sandboxId,
                    cardId: cardImport.cardId,
                    error:
                        error instanceof Error ? error.message : String(error),
                })
            }
        }
    }
}

export {ImportWorkflow}
