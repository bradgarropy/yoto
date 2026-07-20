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
import {logger} from "~/lib/logger.server"
import {destroySandbox} from "~/lib/sandbox.server"
import {EVENT, telemetry} from "~/lib/telemetry.server"
import {getCanonicalYouTubeUrl, getYouTubeUrlType} from "~/lib/youtube"

type ImportStage =
    | "inspect_video"
    | "import_video"
    | "transcode_audio"
    | "update_card"

class ImportWorkflow extends WorkflowEntrypoint<Env, ImportWorkflowParams> {
    override async run(
        event: WorkflowEvent<ImportWorkflowParams>,
        step: WorkflowStep,
    ): Promise<ImportWorkflowResult> {
        const {credential, ...cardImport} = event.payload
        const sandboxId = getImportSandboxId(cardImport)
        const progress = this.env.IMPORT_PROGRESS.getByName(cardImport.id)
        const telemetryContext = {
            importId: cardImport.id,
            cardId: cardImport.cardId,
            youtubeUrl: getCanonicalYouTubeUrl(cardImport.youtubeUrl),
            sourceType: getYouTubeUrlType(cardImport.youtubeUrl),
            splitByChapters: cardImport.splitByChapters,
        }
        const startedAt = event.timestamp.getTime()
        let stage: ImportStage = "inspect_video"

        const getSdk = async () => {
            const token = await readImportCredential(credential, this.env)
            return getYotoSdk(token)
        }
        const reportProgress = (
            update: Parameters<typeof progress.reportProgress>[0],
        ) => progress.reportProgress(update)

        try {
            stage = "inspect_video"
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
            const sourceDurationSeconds = tracks.reduce(
                (total, track) => total + (track.duration ?? 0),
                0,
            )

            stage = "import_video"
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

            stage = "transcode_audio"
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

            stage = "update_card"
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
            telemetry.info(EVENT.IMPORT.COMPLETED, {
                ...telemetryContext,
                durationMs: Date.now() - startedAt,
                sourceTrackCount: tracks.length,
                sourceDurationSeconds,
                added: completedResult.added,
                skipped: completedResult.skipped,
                chapterSplitUnavailable,
            })

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
            telemetry.error(EVENT.IMPORT.FAILED, {
                ...telemetryContext,
                stage,
                reason: "workflow_step_failed",
                errorName: error instanceof Error ? error.name : "UnknownError",
                errorMessage: message,
                durationMs: Date.now() - startedAt,
            })
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
                        logger.info({
                            message: "import.sandbox.destroyed",
                            importId: cardImport.id,
                            sandboxId,
                            cardId: cardImport.cardId,
                        })
                    },
                )
            } catch (error) {
                logger.warn({
                    message: "import.sandbox.destroy_failed",
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
