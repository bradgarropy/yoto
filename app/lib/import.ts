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

type ImportWorkflowResult = {
    importId: string
} & Extract<ImportResult, {status: "success"}>

function getImportSandboxId(cardImport: Import): string {
    return `import-${cardImport.id}`
}

export {getImportSandboxId}
export type {Import, ImportResult, ImportWorkflowParams, ImportWorkflowResult}
