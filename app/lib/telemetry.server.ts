type TelemetryContext = Record<string, unknown>
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
} as const

type EventValue<T> = T extends string
    ? T
    : T extends Record<string, unknown>
      ? EventValue<T[keyof T]>
      : never

type TelemetryEvent = EventValue<typeof EVENT>

function createEvent(
    level: TelemetryLevel,
    event: TelemetryEvent,
    context: TelemetryContext,
) {
    return {
        ...context,
        event,
        level,
    }
}

const telemetry = {
    debug(event: TelemetryEvent, context: TelemetryContext = {}) {
        console.debug(createEvent("debug", event, context))
    },
    info(event: TelemetryEvent, context: TelemetryContext = {}) {
        console.info(createEvent("info", event, context))
    },
    warn(event: TelemetryEvent, context: TelemetryContext = {}) {
        console.warn(createEvent("warn", event, context))
    },
    error(event: TelemetryEvent, context: TelemetryContext = {}) {
        console.error(createEvent("error", event, context))
    },
}

export {EVENT, telemetry}
export type {TelemetryContext, TelemetryEvent}
