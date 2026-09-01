import {logger} from "~/lib/logger.server"

const EVENT = {
    AUTH: {
        LOGIN: {
            STARTED: "auth.login.started",
            COMPLETED: "auth.login.completed",
            FAILED: "auth.login.failed",
        },
        LOGOUT: {
            COMPLETED: "auth.logout.completed",
            FAILED: "auth.logout.failed",
        },
        REFRESH: {
            COMPLETED: "auth.refresh.completed",
            FAILED: "auth.refresh.failed",
        },
    },
    IMPORT: {
        STARTED: "import.started",
        COMPLETED: "import.completed",
        FAILED: "import.failed",
    },
    CARD: {
        CREATE: {
            COMPLETED: "card.create.completed",
            FAILED: "card.create.failed",
        },
        DELETE: {
            COMPLETED: "card.delete.completed",
            FAILED: "card.delete.failed",
        },
        TITLE: {
            COMPLETED: "card.title.completed",
            FAILED: "card.title.failed",
        },
        COVER: {
            COMPLETED: "card.cover.completed",
            FAILED: "card.cover.failed",
        },
    },
    TRACK: {
        COPY: {
            COMPLETED: "track.copy.completed",
            FAILED: "track.copy.failed",
        },
        DELETE: {
            COMPLETED: "track.delete.completed",
            FAILED: "track.delete.failed",
        },
        ICON: {
            COMPLETED: "track.icon.completed",
            FAILED: "track.icon.failed",
        },
        REORDER: {
            COMPLETED: "track.reorder.completed",
            FAILED: "track.reorder.failed",
        },
        NUMBER: {
            COMPLETED: "track.number.completed",
            FAILED: "track.number.failed",
        },
    },
} as const

type EventValue<T> = T extends string
    ? T
    : T extends Record<string, unknown>
      ? EventValue<T[keyof T]>
      : never

type TelemetryEvent = EventValue<typeof EVENT>

type DurationPayload = {
    durationMs: number
}

type AuthFailurePayload = DurationPayload & {
    reason: string
    errorName?: string
}

type ImportPayload = {
    importId: string
    cardId: string
    youtubeUrl: string
    sourceType: "video" | "playlist" | "unknown"
    splitByChapters: boolean
}

type ImportFailurePayload = ImportPayload & {
    stage:
        | "create_workflow"
        | "inspect_video"
        | "check_card_capacity"
        | "process_audio"
        | "update_card"
    errorName: string
    errorMessage?: string
    durationMs?: number
} & (
        | {
              reason: "card_capacity_exceeded"
              existingTrackCount: number
              incomingTrackCount: number
          }
        | {
              reason: "workflow_creation_failed" | "workflow_step_failed"
          }
    )

type TrackOperationPayload = DurationPayload & {
    cardId: string
    destinationCardId?: string
    trackKeys: string[]
    requestedCount: number
    succeededCount: number
    failedCount: number
}

type TrackIconPayload = DurationPayload & {
    cardId: string
    trackKey: string
    iconType: "yoto" | "community"
}

type TrackReorderPayload = DurationPayload & {
    cardId: string
    trackKeys: string[]
    trackCount: number
}

type CardMutationPayload = DurationPayload & {
    cardId: string
}

type CardCreatePayload = DurationPayload & {
    cardId: string
}

type CardCoverPayload = CardMutationPayload & {
    fileSizeBytes: number
    contentType: string
}

type TrackNumberPayload = CardMutationPayload & {
    trackCount: number
    numberedCount: number
}

type TelemetryPayloads = {
    [EVENT.AUTH.LOGIN.STARTED]: undefined
    [EVENT.AUTH.LOGIN.COMPLETED]: DurationPayload
    [EVENT.AUTH.LOGIN.FAILED]: AuthFailurePayload & {
        stage: "initiate" | "complete"
    }
    [EVENT.AUTH.LOGOUT.COMPLETED]: DurationPayload
    [EVENT.AUTH.LOGOUT.FAILED]: AuthFailurePayload
    [EVENT.AUTH.REFRESH.COMPLETED]: DurationPayload
    [EVENT.AUTH.REFRESH.FAILED]: AuthFailurePayload
    [EVENT.IMPORT.STARTED]: ImportPayload
    [EVENT.IMPORT.COMPLETED]: ImportPayload &
        DurationPayload & {
            sourceTrackCount: number
            sourceDurationSeconds: number
            added: number
            skipped: number
            chapterSplitUnavailable: boolean
        }
    [EVENT.IMPORT.FAILED]: ImportFailurePayload
    [EVENT.CARD.CREATE.COMPLETED]: CardCreatePayload
    [EVENT.CARD.CREATE.FAILED]: DurationPayload & {reason: string}
    [EVENT.CARD.DELETE.COMPLETED]: CardMutationPayload
    [EVENT.CARD.DELETE.FAILED]: CardMutationPayload & {reason: string}
    [EVENT.CARD.TITLE.COMPLETED]: CardMutationPayload
    [EVENT.CARD.TITLE.FAILED]: CardMutationPayload & {reason: string}
    [EVENT.CARD.COVER.COMPLETED]: CardCoverPayload
    [EVENT.CARD.COVER.FAILED]: CardCoverPayload & {reason: string}
    [EVENT.TRACK.COPY.COMPLETED]: TrackOperationPayload
    [EVENT.TRACK.COPY.FAILED]: TrackOperationPayload & {reason: string}
    [EVENT.TRACK.DELETE.COMPLETED]: TrackOperationPayload
    [EVENT.TRACK.DELETE.FAILED]: TrackOperationPayload & {reason: string}
    [EVENT.TRACK.ICON.COMPLETED]: TrackIconPayload
    [EVENT.TRACK.ICON.FAILED]: TrackIconPayload & {reason: string}
    [EVENT.TRACK.REORDER.COMPLETED]: TrackReorderPayload
    [EVENT.TRACK.REORDER.FAILED]: TrackReorderPayload & {reason: string}
    [EVENT.TRACK.NUMBER.COMPLETED]: TrackNumberPayload
    [EVENT.TRACK.NUMBER.FAILED]: TrackNumberPayload & {reason: string}
}

type TelemetryArguments<TEvent extends TelemetryEvent> =
    TelemetryPayloads[TEvent] extends undefined
        ? [payload?: undefined]
        : [payload: TelemetryPayloads[TEvent]]

function createEvent<TEvent extends TelemetryEvent>(
    event: TEvent,
    payload: TelemetryPayloads[TEvent] | undefined,
) {
    return {
        ...payload,
        event,
    }
}

const telemetry = {
    debug<TEvent extends TelemetryEvent>(
        event: TEvent,
        ...[payload]: TelemetryArguments<TEvent>
    ) {
        logger.debug(createEvent(event, payload))
    },
    info<TEvent extends TelemetryEvent>(
        event: TEvent,
        ...[payload]: TelemetryArguments<TEvent>
    ) {
        logger.info(createEvent(event, payload))
    },
    warn<TEvent extends TelemetryEvent>(
        event: TEvent,
        ...[payload]: TelemetryArguments<TEvent>
    ) {
        logger.warn(createEvent(event, payload))
    },
    error<TEvent extends TelemetryEvent>(
        event: TEvent,
        ...[payload]: TelemetryArguments<TEvent>
    ) {
        logger.error(createEvent(event, payload))
    },
}

export {EVENT, telemetry}
export type {TelemetryEvent, TelemetryPayloads}
