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
    CardCapacityError,
    checkCardCapacity,
    inspectVideo,
    processAudio,
    updateCard,
} from "~/lib/import.server"
import {readImportCredential} from "~/lib/import-credential.server"
import {logger} from "~/lib/logger.server"
import {destroySandbox} from "~/lib/sandbox.server"
import {EVENT, telemetry} from "~/lib/telemetry.server"
import {getCanonicalYouTubeUrl, getYouTubeUrlType} from "~/lib/youtube"

type ImportStage =
    | "inspect_video"
    | "check_card_capacity"
    | "process_audio"
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

        logger.info({
            message: "import.workflow.started",
            importId: cardImport.id,
            cardId: cardImport.cardId,
            queueDurationMs: Date.now() - startedAt,
        })

        const getSdk = async () => {
            const sdkStartedAt = Date.now()
            const token = await readImportCredential(credential, this.env)
            const sdk = getYotoSdk(token)

            logger.debug({
                message: "import.sdk.created",
                importId: cardImport.id,
                cardId: cardImport.cardId,
                stage,
                durationMs: Date.now() - sdkStartedAt,
            })

            return sdk
        }
        const reportProgress = async (
            update: Parameters<typeof progress.reportProgress>[0],
        ) => {
            const progressStartedAt = Date.now()
            await progress.reportProgress(update)
            logger.debug({
                message: "import.progress.published",
                importId: cardImport.id,
                cardId: cardImport.cardId,
                phase: update.phase,
                durationMs: Date.now() - progressStartedAt,
            })
        }

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

            stage = "check_card_capacity"
            await step.do(
                "check card capacity",
                {
                    retries: {limit: 0, delay: 0},
                    timeout: "1 minute",
                },
                async () => {
                    const sdk = await getSdk()
                    await checkCardCapacity(sdk, cardImport, tracks)
                },
            )

            stage = "process_audio"
            const transcodedTracks = await step.do(
                "process audio",
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
                    return processAudio(
                        sdk,
                        this.env,
                        cardImport,
                        tracks,
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
                        cardImport,
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
            const failureContext = {
                ...telemetryContext,
                stage,
                errorName: error instanceof Error ? error.name : "UnknownError",
                errorMessage: message,
                durationMs: Date.now() - startedAt,
            }

            if (error instanceof CardCapacityError) {
                telemetry.warn(EVENT.IMPORT.FAILED, {
                    ...failureContext,
                    reason: "card_capacity_exceeded",
                    existingTrackCount: error.existingTrackCount,
                    incomingTrackCount: error.incomingTrackCount,
                })
            } else {
                telemetry.error(EVENT.IMPORT.FAILED, {
                    ...failureContext,
                    reason: "workflow_step_failed",
                })
            }
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
                        const cleanupStartedAt = Date.now()
                        await destroySandbox(this.env, sandboxId)
                        logger.info({
                            message: "import.sandbox.destroyed",
                            importId: cardImport.id,
                            sandboxId,
                            cardId: cardImport.cardId,
                            durationMs: Date.now() - cleanupStartedAt,
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
