const isUrl = (input: string): boolean => {
    try {
        new URL(input)
        return true
    } catch {
        return false
    }
}

const isPlaylistUrl = (input: string): boolean => {
    return isUrl(input) && (input.includes("playlist?list=") || input.includes("&list=PL"))
}

const isVideoUrl = (input: string): boolean => {
    return isUrl(input) && !isPlaylistUrl(input)
}

export {isUrl, isPlaylistUrl, isVideoUrl}
