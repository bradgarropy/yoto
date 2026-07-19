type TelemetryLevel = "debug" | "info" | "warn" | "error"

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
    TRACK: {
        COPY: {
            COMPLETED: "track.copy.completed",
            FAILED: "track.copy.failed",
        },
        DELETE: {
            COMPLETED: "track.delete.completed",
            FAILED: "track.delete.failed",
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

type TrackOperationPayload = DurationPayload & {
    cardId: string
    destinationCardId?: string
    trackKeys: string[]
    requestedCount: number
    succeededCount: number
    failedCount: number
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
    [EVENT.IMPORT.FAILED]: ImportPayload & {
        stage:
            | "create_workflow"
            | "inspect_video"
            | "import_video"
            | "transcode_audio"
            | "update_card"
        reason: string
        errorName: string
        errorMessage?: string
        durationMs?: number
    }
    [EVENT.TRACK.COPY.COMPLETED]: TrackOperationPayload
    [EVENT.TRACK.COPY.FAILED]: TrackOperationPayload & {reason: string}
    [EVENT.TRACK.DELETE.COMPLETED]: TrackOperationPayload
    [EVENT.TRACK.DELETE.FAILED]: TrackOperationPayload & {reason: string}
}

type TelemetryArguments<TEvent extends TelemetryEvent> =
    TelemetryPayloads[TEvent] extends undefined
        ? [payload?: undefined]
        : [payload: TelemetryPayloads[TEvent]]

function createEvent<TEvent extends TelemetryEvent>(
    level: TelemetryLevel,
    event: TEvent,
    payload: TelemetryPayloads[TEvent] | undefined,
) {
    return {
        ...payload,
        event,
        level,
    }
}

const telemetry = {
    debug<TEvent extends TelemetryEvent>(
        event: TEvent,
        ...[payload]: TelemetryArguments<TEvent>
    ) {
        console.debug(createEvent("debug", event, payload))
    },
    info<TEvent extends TelemetryEvent>(
        event: TEvent,
        ...[payload]: TelemetryArguments<TEvent>
    ) {
        console.info(createEvent("info", event, payload))
    },
    warn<TEvent extends TelemetryEvent>(
        event: TEvent,
        ...[payload]: TelemetryArguments<TEvent>
    ) {
        console.warn(createEvent("warn", event, payload))
    },
    error<TEvent extends TelemetryEvent>(
        event: TEvent,
        ...[payload]: TelemetryArguments<TEvent>
    ) {
        console.error(createEvent("error", event, payload))
    },
}

export {EVENT, telemetry}
export type {TelemetryEvent, TelemetryPayloads}
