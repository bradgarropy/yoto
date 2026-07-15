import {type SubmitEvent, useCallback, useEffect, useRef, useState} from "react"
import {useRevalidator} from "react-router"
import {toast} from "sonner"

import {Button} from "~/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog"
import {Input} from "~/components/ui/input"
import {Progress} from "~/components/ui/progress"
import {
    getTerminalImportResult,
    type ImportResult,
    type ImportStatusResponse,
} from "~/lib/import"
import {getProgressPercent, type ImportProgress} from "~/lib/import-utils"

const IMPORT_POLL_INTERVAL_MS = 2_000
const IMPORT_POLL_MAX_FAILURES = 3

type ImportState =
    | {status: "idle"}
    | {status: "importing"; progress: ImportProgress | null}
    | {status: "complete"; added: number; skipped: number; message: string}
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
    const [pollingImportId, setPollingImportId] = useState<string | null>(null)
    const eventSourceRef = useRef<EventSource | null>(null)
    const importIdRef = useRef<string | null>(null)
    const revalidator = useRevalidator()

    const isImporting = importState.status === "importing"

    const completeImport = useCallback(
        (result: Extract<ImportResult, {status: "success"}>) => {
            importIdRef.current = null
            setPollingImportId(null)
            setImportState({
                status: "complete",
                added: result.added,
                skipped: result.skipped,
                message: result.message,
            })
            setYoutubeUrl("")
            revalidator.revalidate()
        },
        [revalidator],
    )

    const failImport = useCallback((error: string) => {
        importIdRef.current = null
        setPollingImportId(null)
        setImportState({status: "error", error})
    }, [])

    const startImport = useCallback(() => {
        if (!youtubeUrl.trim()) return

        // Clean up any existing connection
        if (eventSourceRef.current) {
            eventSourceRef.current.close()
        }

        importIdRef.current = null
        setImportState({status: "importing", progress: null})

        const url = `/api/import/${cardId}?url=${encodeURIComponent(youtubeUrl)}`
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
                    completeImport({
                        status: "success",
                        added: data.added,
                        skipped: data.skipped,
                        message: data.message,
                    })
                    eventSource.close()
                } else if (data.type === "error") {
                    failImport(data.error)
                    eventSource.close()
                } else {
                    // Unexpected payload shape or type
                    failImport(
                        "Unexpected response from server. Please try again.",
                    )
                    eventSource.close()
                }
            } catch {
                // Treat JSON parse failures as an error so the user can retry
                failImport("Unexpected response from server. Please try again.")
                eventSource.close()
            }
        }

        eventSource.onerror = () => {
            eventSource.close()

            if (importIdRef.current) {
                setPollingImportId(importIdRef.current)
            } else {
                failImport("Connection lost. Please try again.")
            }
        }
    }, [cardId, completeImport, failImport, youtubeUrl])

    useEffect(() => {
        if (!pollingImportId) return

        let cancelled = false
        let failures = 0
        let timeout: ReturnType<typeof setTimeout> | undefined

        const pollImport = async () => {
            try {
                const response = await fetch(`/api/imports/${pollingImportId}`)

                if (!response.ok) {
                    throw new Error("Unable to get import status")
                }

                const importStatus =
                    (await response.json()) as ImportStatusResponse

                if (cancelled) return
                failures = 0

                const result = getTerminalImportResult(importStatus)

                if (result?.status === "success") {
                    completeImport(result)
                    return
                }

                if (result?.status === "error") {
                    failImport(result.error)
                    return
                }
            } catch {
                if (cancelled) return

                failures++

                if (failures >= IMPORT_POLL_MAX_FAILURES) {
                    failImport("Connection lost. Please try again.")
                    return
                }
            }

            timeout = setTimeout(pollImport, IMPORT_POLL_INTERVAL_MS)
        }

        void pollImport()

        return () => {
            cancelled = true
            if (timeout) clearTimeout(timeout)
        }
    }, [completeImport, failImport, pollingImportId])

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
            toast.success(importState.message)
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
                <form onSubmit={handleSubmit} className="space-y-4">
                    <Input
                        type="url"
                        placeholder="https://www.youtube.com/watch?v=abc123"
                        required
                        disabled={isBusy || isImporting}
                        value={youtubeUrl}
                        onChange={e => setYoutubeUrl(e.target.value)}
                    />
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
