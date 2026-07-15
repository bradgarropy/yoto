type Import = {
    id: string
    cardId: string
    youtubeUrl: string
}

function getImportSandboxId(cardImport: Import): string {
    return `import-${cardImport.id}`
}

export {getImportSandboxId}
export type {Import}
