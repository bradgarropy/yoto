type Upload = {
    id: string
    cardId: string
    youtubeUrl: string
}

function getUploadSandboxId(upload: Upload): string {
    return `upload-${upload.id}`
}

export {getUploadSandboxId}
export type {Upload}
