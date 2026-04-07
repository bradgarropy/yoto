const formatDuration = (seconds?: number): string => {
    if (!seconds) {
        return ""
    }

    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60

    const duration = `${mins}:${secs.toString().padStart(2, "0")}`
    return duration
}

export {formatDuration}
