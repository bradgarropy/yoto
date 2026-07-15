type Import = {
    id: string
    cardId: string
    youtubeUrl: string
}

type ImportWorkflowParams = Import & {
    credential: string
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

const IMPORT_EVENT = {
    COMPLETE: "complete",
} as const

function getImportSandboxId(cardImport: Import): string {
    return `import-${cardImport.id}`
}

export {getImportSandboxId, IMPORT_EVENT}
export type {Import, ImportResult, ImportWorkflowParams}
