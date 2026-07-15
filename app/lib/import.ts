type Import = {
    id: string
    cardId: string
    youtubeUrl: string
}

type ImportResult =
    | {
          status: "success"
          message: string
          added: number
          skipped: number
      }
    | {
          status: "error"
          error: string
      }

const IMPORT_STATUS = {
    QUEUED: "queued",
    RUNNING: "running",
    PAUSED: "paused",
    ERRORED: "errored",
    TERMINATED: "terminated",
    COMPLETE: "complete",
    WAITING: "waiting",
    WAITING_FOR_PAUSE: "waitingForPause",
    UNKNOWN: "unknown",
} as const

type ImportStatus = (typeof IMPORT_STATUS)[keyof typeof IMPORT_STATUS]

type ImportStatusResponse = {
    importId: string
    status: ImportStatus
    error: {name: string; message: string} | null
    output: ({importId: string} & ImportResult) | null
}

const IMPORT_EVENT = {
    COMPLETE: "complete",
} as const

function getImportSandboxId(cardImport: Import): string {
    return `import-${cardImport.id}`
}

function getTerminalImportResult(
    response: ImportStatusResponse,
): ImportResult | null {
    if (response.status === IMPORT_STATUS.COMPLETE) {
        return (
            response.output ?? {
                status: "error",
                error: "Import completed without a result.",
            }
        )
    }

    if (
        response.status === IMPORT_STATUS.ERRORED ||
        response.status === IMPORT_STATUS.TERMINATED
    ) {
        return {
            status: "error",
            error: response.error?.message ?? "Import failed.",
        }
    }

    return null
}

export {
    getImportSandboxId,
    getTerminalImportResult,
    IMPORT_EVENT,
    IMPORT_STATUS,
}
export type {Import, ImportResult, ImportStatus, ImportStatusResponse}
