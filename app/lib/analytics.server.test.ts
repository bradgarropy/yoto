import {describe, expect, it} from "vitest"

import {
    ANALYTICS_COLUMN,
    createAnalyticsDataPoint,
} from "~/lib/analytics.server"
import {EVENT} from "~/lib/telemetry.server"

describe("createAnalyticsDataPoint", () => {
    it("serializes a completed import", () => {
        const dataPoint = createAnalyticsDataPoint(EVENT.IMPORT.COMPLETED, {
            importId: "import-123",
            cardId: "card-123",
            youtubeUrl: "https://www.youtube.com/watch?v=abc123",
            sourceType: "video",
            splitByChapters: true,
            durationMs: 12_000,
            sourceTrackCount: 4,
            sourceDurationSeconds: 3_600,
            added: 3,
            skipped: 1,
            chapterSplitUnavailable: false,
        })

        expect(dataPoint).toEqual({
            indexes: ["import"],
            blobs: [
                "import.completed",
                "import",
                "import",
                "completed",
                null,
                "video",
                null,
                null,
                null,
                null,
                "card-123",
                "import-123",
                null,
            ],
            doubles: [12_000, 4, 3_600, 3, 1, 0, 0, 0, 0, 0, 0, 1, 0],
        })
    })

    it("serializes an authentication failure", () => {
        const dataPoint = createAnalyticsDataPoint(EVENT.AUTH.LOGIN.FAILED, {
            stage: "complete",
            reason: "access_denied",
            errorName: "AuthenticationError",
            durationMs: 500,
        })

        expect(dataPoint).toEqual({
            indexes: ["auth.login"],
            blobs: [
                "auth.login.failed",
                "auth",
                "auth.login",
                "failed",
                "access_denied",
                null,
                "complete",
                "AuthenticationError",
                null,
                null,
                null,
                null,
                null,
            ],
            doubles: [500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        })
    })

    it("serializes events without a payload", () => {
        const dataPoint = createAnalyticsDataPoint(
            EVENT.AUTH.LOGIN.STARTED,
            undefined,
        )

        expect(dataPoint).toEqual({
            indexes: ["auth.login"],
            blobs: [
                "auth.login.started",
                "auth",
                "auth.login",
                "started",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
            ],
            doubles: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        })
    })

    it("documents the stable Analytics Engine columns", () => {
        expect(ANALYTICS_COLUMN).toEqual({
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
        })
    })
})
