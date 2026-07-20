import type {TelemetryEvent, TelemetryPayloads} from "~/lib/telemetry.server"

const ANALYTICS_COLUMN = {
    INDEX: {
        OPERATION: "index1",
    },
    BLOB: {
        EVENT: "blob1",
        DOMAIN: "blob2",
        OPERATION: "blob3",
        STATUS: "blob4",
        REASON: "blob5",
        SOURCE_TYPE: "blob6",
        STAGE: "blob7",
        ERROR_NAME: "blob8",
        ICON_TYPE: "blob9",
        CONTENT_TYPE: "blob10",
        CARD_ID: "blob11",
        IMPORT_ID: "blob12",
        DESTINATION_CARD_ID: "blob13",
    },
    DOUBLE: {
        DURATION_MS: "double1",
        SOURCE_TRACK_COUNT: "double2",
        SOURCE_DURATION_SECONDS: "double3",
        ADDED: "double4",
        SKIPPED: "double5",
        REQUESTED_COUNT: "double6",
        SUCCEEDED_COUNT: "double7",
        FAILED_COUNT: "double8",
        TRACK_COUNT: "double9",
        NUMBERED_COUNT: "double10",
        FILE_SIZE_BYTES: "double11",
        SPLIT_BY_CHAPTERS: "double12",
        CHAPTER_SPLIT_UNAVAILABLE: "double13",
    },
} as const

function getEventParts(event: TelemetryEvent) {
    const parts = event.split(".")
    const status = parts.at(-1) ?? ""
    const operation = parts.slice(0, -1).join(".")

    return {
        domain: parts[0] ?? "",
        operation,
        status,
    }
}

function getString(record: Record<string, unknown>, key: string) {
    const value = record[key]
    return typeof value === "string" ? value : null
}

function getNumber(record: Record<string, unknown>, key: string) {
    const value = record[key]
    return typeof value === "number" ? value : 0
}

function getBoolean(record: Record<string, unknown>, key: string) {
    return record[key] === true ? 1 : 0
}

function createAnalyticsDataPoint<TEvent extends TelemetryEvent>(
    event: TEvent,
    payload: TelemetryPayloads[TEvent] | undefined,
): AnalyticsEngineDataPoint {
    const record = (payload ?? {}) as Record<string, unknown>
    const {domain, operation, status} = getEventParts(event)

    return {
        indexes: [operation],
        blobs: [
            event,
            domain,
            operation,
            status,
            getString(record, "reason"),
            getString(record, "sourceType"),
            getString(record, "stage"),
            getString(record, "errorName"),
            getString(record, "iconType"),
            getString(record, "contentType"),
            getString(record, "cardId"),
            getString(record, "importId"),
            getString(record, "destinationCardId"),
        ],
        doubles: [
            getNumber(record, "durationMs"),
            getNumber(record, "sourceTrackCount"),
            getNumber(record, "sourceDurationSeconds"),
            getNumber(record, "added"),
            getNumber(record, "skipped"),
            getNumber(record, "requestedCount"),
            getNumber(record, "succeededCount"),
            getNumber(record, "failedCount"),
            getNumber(record, "trackCount"),
            getNumber(record, "numberedCount"),
            getNumber(record, "fileSizeBytes"),
            getBoolean(record, "splitByChapters"),
            getBoolean(record, "chapterSplitUnavailable"),
        ],
    }
}

function writeAnalyticsEvent<TEvent extends TelemetryEvent>(
    analytics: AnalyticsEngineDataset,
    event: TEvent,
    payload: TelemetryPayloads[TEvent] | undefined,
) {
    analytics.writeDataPoint(createAnalyticsDataPoint(event, payload))
}

export {
    ANALYTICS_COLUMN,
    createAnalyticsDataPoint,
    writeAnalyticsEvent,
}
