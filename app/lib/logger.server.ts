type LogLevel = "debug" | "info" | "warn" | "error"
type LogRecord = Record<string, unknown>

function serializeError(error: Error) {
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
    }
}

function createLogRecord(level: LogLevel, record: LogRecord) {
    return {
        ...Object.fromEntries(
            Object.entries(record).map(([key, value]) => [
                key,
                value instanceof Error ? serializeError(value) : value,
            ]),
        ),
        level,
    }
}

const logger = {
    debug(record: LogRecord) {
        console.debug(createLogRecord("debug", record))
    },
    info(record: LogRecord) {
        console.info(createLogRecord("info", record))
    },
    warn(record: LogRecord) {
        console.warn(createLogRecord("warn", record))
    },
    error(record: LogRecord) {
        console.error(createLogRecord("error", record))
    },
}

export {logger}
export type {LogLevel, LogRecord}
