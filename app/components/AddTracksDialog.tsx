import {type SubmitEvent, useCallback, useEffect, useRef, useState} from "react"
import {useRevalidator} from "react-router"
import {toast} from "sonner"

import {Button} from "~/components/ui/button"
import {Checkbox} from "~/components/ui/checkbox"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog"
import {Input} from "~/components/ui/input"
import {Label} from "~/components/ui/label"
import {Progress} from "~/components/ui/progress"
import {getProgressPercent, type ImportProgress} from "~/lib/import-utils"
import {getYouTubeUrlType} from "~/lib/youtube"

type ImportState =
    | {status: "idle"}
    | {status: "importing"; progress: ImportProgress | null}
    | {
          status: "complete"
          added: number
          skipped: number
          message: string
          description?: string
      }
    | {status: "error"; error: string}

const getProgressMessage = (progress: ImportProgress | null): string => {
    if (!progress) return "Preparing..."

    switch (progress.phase) {
        case "preparing":
            return "Preparing..."
        case "downloading":
            return progress.current && progress.total
                ? `Downloading... (${progress.current}/${progress.total})`
                : "Downloading..."
        case "uploading":
            return progress.current && progress.total
                ? `Uploading... (${progress.current}/${progress.total})`
                : "Uploading..."
        case "transcoding":
            return progress.current && progress.total
                ? `Transcoding... (${progress.current}/${progress.total})`
                : "Transcoding..."
        case "finalizing":
            return "Finalizing..."
        default:
            return "Processing..."
    }
}

const AddTracksDialog = ({
    cardId,
    isBusy,
    open,
    onOpenChange,
}: {
    cardId: string
    isBusy: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
}) => {
    const [importState, setImportState] = useState<ImportState>({
        status: "idle",
    })
    const [youtubeUrl, setYoutubeUrl] = useState("")
    const [splitByChapters, setSplitByChapters] = useState(false)
    const eventSourceRef = useRef<EventSource | null>(null)
    const importIdRef = useRef<string | null>(null)
    const revalidator = useRevalidator()

    const isImporting = importState.status === "importing"
    const isVideoUrl = getYouTubeUrlType(youtubeUrl) === "video"

    const handleYoutubeUrlChange = (value: string) => {
        setYoutubeUrl(value)

        if (getYouTubeUrlType(value) !== "video") {
            setSplitByChapters(false)
        }
    }

    const startImport = useCallback(() => {
        if (!youtubeUrl.trim()) return

        // Clean up any existing connection
        if (eventSourceRef.current) {
            eventSourceRef.current.close()
        }

        importIdRef.current = null
        setImportState({status: "importing", progress: null})

        const searchParams = new URLSearchParams({
            url: youtubeUrl,
            splitByChapters: String(splitByChapters),
        })
        const url = `/api/import/${cardId}?${searchParams}`
        const eventSource = new EventSource(url)
        eventSourceRef.current = eventSource

        eventSource.onmessage = event => {
            try {
                const data = JSON.parse(event.data)

                if (data.type === "started") {
                    importIdRef.current = data.importId
                } else if (data.type === "progress") {
                    setImportState({
                        status: "importing",
                        progress: {
                            phase: data.phase,
                            current: data.current,
                            total: data.total,
                            title: data.title,
                        },
                    })
                } else if (data.type === "complete") {
                    setImportState({
                        status: "complete",
                        added: data.added,
                        skipped: data.skipped,
                        message: data.message,
                        description: data.description,
                    })
                    eventSource.close()
                    setYoutubeUrl("")
                    setSplitByChapters(false)
                    revalidator.revalidate()
                } else if (data.type === "error") {
                    setImportState({status: "error", error: data.error})
                    eventSource.close()
                } else {
                    // Unexpected payload shape or type
                    setImportState({
                        status: "error",
                        error: "Unexpected response from server. Please try again.",
                    })
                    eventSource.close()
                }
            } catch {
                // Treat JSON parse failures as an error so the user can retry
                setImportState({
                    status: "error",
                    error: "Unexpected response from server. Please try again.",
                })
                eventSource.close()
            }
        }

        eventSource.onerror = () => {
            setImportState({
                status: "error",
                error: "Connection lost. Please try again.",
            })
            eventSource.close()
        }
    }, [cardId, youtubeUrl, splitByChapters, revalidator])

    // Clean up on unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close()
            }
        }
    }, [])

    // Show toast and close dialog on completion/error
    useEffect(() => {
        if (importState.status === "complete") {
            toast.success(importState.message, {
                description: importState.description,
            })
            onOpenChange(false)
            // Reset to idle after closing
            const timer = setTimeout(
                () => setImportState({status: "idle"}),
                300,
            )
            return () => clearTimeout(timer)
        } else if (importState.status === "error") {
            toast.error(importState.error)
            // Reset to idle after showing toast
            const timer = setTimeout(
                () => setImportState({status: "idle"}),
                3000,
            )
            return () => clearTimeout(timer)
        }
    }, [importState, onOpenChange])

    const progress =
        importState.status === "importing" ? importState.progress : null

    const handleSubmit = (e: SubmitEvent<HTMLFormElement>) => {
        e.preventDefault()
        startImport()
    }

    // Block closing the dialog while importing
    const handleOpenChange = (newOpen: boolean) => {
        if (!newOpen && isImporting) return
        onOpenChange(newOpen)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                onPointerDownOutside={e => {
                    if (isImporting) e.preventDefault()
                }}
                onEscapeKeyDown={e => {
                    if (isImporting) e.preventDefault()
                }}
            >
                <DialogHeader>
                    <DialogTitle>Add Tracks</DialogTitle>
                    <DialogDescription>
                        Paste a YouTube video or playlist URL to import tracks.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-6 pt-2">
                    <div className="space-y-2">
                        <Input
                            type="url"
                            placeholder="https://www.youtube.com/watch?v=abc123"
                            required
                            disabled={isBusy || isImporting}
                            value={youtubeUrl}
                            onChange={e =>
                                handleYoutubeUrlChange(e.target.value)
                            }
                        />
                        {isVideoUrl && (
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="split-by-chapters"
                                    checked={splitByChapters}
                                    disabled={isBusy || isImporting}
                                    onCheckedChange={checked =>
                                        setSplitByChapters(checked === true)
                                    }
                                />
                                <Label
                                    htmlFor="split-by-chapters"
                                    className="cursor-pointer"
                                >
                                    Split by chapters
                                </Label>
                            </div>
                        )}
                    </div>
                    <Button
                        type="submit"
                        disabled={isBusy || isImporting || !youtubeUrl.trim()}
                        className="w-full"
                    >
                        Import
                    </Button>

                    {isImporting && (
                        <div className="space-y-2">
                            <Progress value={getProgressPercent(progress)} />
                            <p className="text-sm text-muted-foreground">
                                {getProgressMessage(progress)}
                            </p>
                        </div>
                    )}
                </form>
            </DialogContent>
        </Dialog>
    )
}

export {AddTracksDialog}
