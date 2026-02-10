import {GripVertical, Trash2} from "lucide-react"
import {Reorder} from "motion/react"
import {type SubmitEvent, useCallback, useEffect, useRef, useState} from "react"
import {
    Form,
    Link,
    redirect,
    useActionData,
    useFetcher,
    useNavigation,
    useRevalidator,
} from "react-router"
import {toast} from "sonner"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "~/components/ui/alert-dialog"
import {Button} from "~/components/ui/button"
import {Card, CardContent, CardHeader, CardTitle} from "~/components/ui/card"
import {Input} from "~/components/ui/input"
import {Progress} from "~/components/ui/progress"
import {getAuthenticatedSdk, requireAuth} from "~/lib/auth.server"
import {
    getProgressPercent,
    type ImportProgress,
    stripNullValues,
} from "~/lib/sync-utils"
import {
    getCardTracks,
    removeCardTracks,
    removeSyncedTrack,
} from "~/lib/tracks.server"

export function meta({
    data,
}: {
    data: Awaited<ReturnType<typeof loader>> | undefined
}) {
    const title = data?.card?.title ?? "Card"
    return [
        {title: `Yoto - ${title}`},
        {name: "description", content: `View ${title} card details`},
    ]
}

export async function loader({params}: {params: {id: string}}) {
    await requireAuth()

    const cardId = params.id

    try {
        const sdk = await getAuthenticatedSdk()
        const card = await sdk.content.getCard(cardId)

        // Type assertion for SDK response - getCard returns the card directly
        const cardData = card as unknown as {
            cardId: string
            title?: string
            metadata?: {
                coverImageUrl?: string
                cover?: {
                    imageL?: string
                    imageM?: string
                    imageS?: string
                }
            }
            content?: {
                chapters?: Array<{
                    key?: string
                    title?: string
                    duration?: number
                }>
            }
        }

        if (!cardData) {
            throw new Error("Card not found")
        }

        // Get synced tracks from local storage
        const syncedTracks = getCardTracks(cardId)
        const syncedVideoIds = new Set(
            syncedTracks?.videos.map(v => v.youtubeVideoId) ?? [],
        )

        // Map track keys to YouTube video IDs for display
        const trackKeyToVideo = new Map(
            syncedTracks?.videos.map(v => [v.yotoTrackKey, v]) ?? [],
        )

        const chapters = cardData.content?.chapters ?? []

        // Get cover URL - check metadata.cover first, then coverImageUrl as fallback
        const coverUrl =
            cardData.metadata?.cover?.imageL ??
            cardData.metadata?.cover?.imageM ??
            cardData.metadata?.cover?.imageS ??
            cardData.metadata?.coverImageUrl

        return {
            card: {
                id: cardData.cardId ?? cardId,
                title: cardData.title ?? "Untitled Card",
                coverUrl,
            },
            tracks: chapters.map(
                (chapter: {
                    key?: string
                    title?: string
                    duration?: number
                }) => {
                    const syncedVideo = trackKeyToVideo.get(chapter.key ?? "")
                    return {
                        key: chapter.key ?? "",
                        title: chapter.title ?? "Untitled Track",
                        duration: chapter.duration,
                        youtubeVideoId: syncedVideo?.youtubeVideoId,
                        syncedAt: syncedVideo?.syncedAt,
                    }
                },
            ),
            syncedCount: syncedVideoIds.size,
            youtubePlaylistId: syncedTracks?.youtubePlaylistId,
            lastSynced: syncedTracks?.lastSynced,
        }
    } catch (error) {
        console.error("Failed to fetch card:", error)
        throw new Response("Card not found", {status: 404})
    }
}

export async function action({
    params,
    request,
}: {
    params: {id: string}
    request: Request
}) {
    await requireAuth()

    const cardId = params.id
    const formData = await request.formData()
    const intent = formData.get("intent")

    try {
        const sdk = await getAuthenticatedSdk()

        if (intent === "deleteTrack") {
            const trackKey = formData.get("trackKey") as string

            if (!trackKey) {
                return {error: "Track key is required"}
            }

            // Get current card
            const card = (await sdk.content.getCard(cardId)) as unknown as {
                cardId: string
                title?: string
                content: {
                    activity: string
                    chapters: Array<{key?: string; [key: string]: unknown}>
                    restricted: boolean
                    config: {onlineOnly: boolean}
                    version: string
                }
                metadata: Record<string, unknown>
            }

            // Filter out the track to delete
            const updatedChapters = card.content.chapters.filter(
                chapter => chapter.key !== trackKey,
            )

            // Update card with remaining chapters
            const updatedCard = {
                cardId,
                title: card.title,
                content: {
                    ...card.content,
                    chapters: stripNullValues(updatedChapters),
                },
                metadata: card.metadata,
            }

            await sdk.content.updateCard(
                updatedCard as unknown as Parameters<
                    typeof sdk.content.updateCard
                >[0],
            )

            // Remove from local tracks.json
            removeSyncedTrack(cardId, trackKey)

            return {success: true, deleted: trackKey}
        }

        if (intent === "deleteCard") {
            await sdk.content.deleteCard(cardId)

            // Clean up local tracks data
            removeCardTracks(cardId)

            return redirect("/")
        }

        if (intent === "reorderTracks") {
            const trackKeysJson = formData.get("trackKeys") as string

            if (!trackKeysJson) {
                return {error: "Track keys are required"}
            }

            const newOrder = JSON.parse(trackKeysJson) as string[]

            // Get current card
            const card = (await sdk.content.getCard(cardId)) as unknown as {
                cardId: string
                title?: string
                content: {
                    activity: string
                    chapters: Array<{key?: string; [key: string]: unknown}>
                    restricted: boolean
                    config: {onlineOnly: boolean}
                    version: string
                }
                metadata: Record<string, unknown>
            }

            // Create a map of key -> chapter for reordering
            const chapterMap = new Map(
                card.content.chapters.map(chapter => [chapter.key, chapter]),
            )

            // Reorder chapters to match the new order
            const reorderedChapters = newOrder
                .map(key => chapterMap.get(key))
                .filter(
                    (chapter): chapter is NonNullable<typeof chapter> =>
                        chapter !== undefined,
                )

            // Update card with reordered chapters
            const updatedCard = {
                cardId,
                title: card.title,
                content: {
                    ...card.content,
                    chapters: stripNullValues(reorderedChapters),
                },
                metadata: card.metadata,
            }

            await sdk.content.updateCard(
                updatedCard as unknown as Parameters<
                    typeof sdk.content.updateCard
                >[0],
            )

            return {success: true, reordered: true}
        }

        return {error: "Invalid intent"}
    } catch (error) {
        console.error("Failed to perform action:", error)
        return {error: "Operation failed"}
    }
}

function formatDuration(seconds?: number): string {
    if (!seconds) return ""
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
}

function formatDate(dateStr?: string): string {
    if (!dateStr) return ""
    return new Date(dateStr).toLocaleDateString()
}

type ActionData = {
    error?: string
    success?: boolean
    message?: string
    added?: number
    skipped?: number
    deleted?: string
    reordered?: boolean
}

type Track = {
    key: string
    title: string
    duration?: number
    youtubeVideoId?: string
    syncedAt?: string
}

type ImportState =
    | {status: "idle"}
    | {status: "importing"; progress: ImportProgress | null}
    | {status: "complete"; added: number; skipped: number; message: string}
    | {status: "error"; error: string}

function getProgressMessage(progress: ImportProgress | null): string {
    if (!progress) return "Starting import..."

    switch (progress.phase) {
        case "fetching":
            return "Fetching video information from YouTube..."
        case "downloading":
            return progress.current && progress.total
                ? `Downloading track ${progress.current} of ${progress.total}: ${progress.title || "..."}`
                : "Downloading..."
        case "uploading":
            return progress.current && progress.total
                ? `Uploading track ${progress.current} of ${progress.total}: ${progress.title || "..."}`
                : "Uploading..."
        case "transcoding":
            return "Processing audio..."
        case "updating":
            return "Updating card..."
        default:
            return "Processing..."
    }
}

function AddTracksForm({cardId, isBusy}: {cardId: string; isBusy: boolean}) {
    const [importState, setImportState] = useState<ImportState>({
        status: "idle",
    })
    const [youtubeUrl, setYoutubeUrl] = useState("")
    const eventSourceRef = useRef<EventSource | null>(null)
    const revalidator = useRevalidator()

    const startImport = useCallback(() => {
        if (!youtubeUrl.trim()) return

        // Clean up any existing connection
        if (eventSourceRef.current) {
            eventSourceRef.current.close()
        }

        setImportState({status: "importing", progress: null})

        const url = `/api/import/${cardId}?url=${encodeURIComponent(youtubeUrl)}`
        const eventSource = new EventSource(url)
        eventSourceRef.current = eventSource

        eventSource.onmessage = event => {
            try {
                const data = JSON.parse(event.data)

                if (data.type === "progress") {
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
                    })
                    eventSource.close()
                    setYoutubeUrl("")
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
    }, [cardId, youtubeUrl, revalidator])

    // Clean up on unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close()
            }
        }
    }, [])

    // Show toast on completion/error
    useEffect(() => {
        if (importState.status === "complete") {
            toast.success(importState.message)
            // Reset to idle after showing toast
            const timer = setTimeout(
                () => setImportState({status: "idle"}),
                3000,
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
    }, [importState])

    const isImporting = importState.status === "importing"
    const progress =
        importState.status === "importing" ? importState.progress : null

    const handleSubmit = (e: SubmitEvent<HTMLFormElement>) => {
        e.preventDefault()
        startImport()
    }

    return (
        <Card className="mt-6">
            <CardHeader>
                <CardTitle className="text-lg">Add Tracks</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="flex gap-2">
                        <Input
                            type="url"
                            placeholder="https://www.youtube.com/watch?v=abc123"
                            required
                            disabled={isBusy || isImporting}
                            className="flex-1"
                            value={youtubeUrl}
                            onChange={e => setYoutubeUrl(e.target.value)}
                        />
                        <Button
                            type="submit"
                            disabled={
                                isBusy || isImporting || !youtubeUrl.trim()
                            }
                        >
                            {isImporting ? "Importing..." : "Import"}
                        </Button>
                    </div>

                    {isImporting && (
                        <div className="space-y-2">
                            <Progress value={getProgressPercent(progress)} />
                            <p className="text-sm text-muted-foreground">
                                {getProgressMessage(progress)}
                            </p>
                        </div>
                    )}
                </form>
            </CardContent>
        </Card>
    )
}

export default function CardDetail({
    loaderData,
}: {
    loaderData: Awaited<ReturnType<typeof loader>>
}) {
    const {card, tracks, syncedCount, youtubePlaylistId, lastSynced} =
        loaderData
    const navigation = useNavigation()
    const actionData = useActionData<ActionData>()
    const reorderFetcher = useFetcher<ActionData>()

    // Local state for optimistic reordering
    const [orderedTracks, setOrderedTracks] = useState<Track[]>(tracks)
    const hasOrderChangedRef = useRef(false)

    // Sync local state with loader data when it changes
    useEffect(() => {
        setOrderedTracks(tracks)
        hasOrderChangedRef.current = false
    }, [tracks])

    const isBusy = navigation.state !== "idle"
    const isReordering = reorderFetcher.state !== "idle"
    const pendingIntent = navigation.formData?.get("intent")
    const isDeletingCard = pendingIntent === "deleteCard"

    // Handle visual reorder during drag (no API call)
    const handleReorder = (newOrder: Track[]) => {
        setOrderedTracks(newOrder)
        hasOrderChangedRef.current = true
    }

    // Save to API only when drag ends
    const handleDragEnd = () => {
        // Only submit if order changed (ref check is synchronous to prevent double calls)
        if (hasOrderChangedRef.current) {
            hasOrderChangedRef.current = false
            reorderFetcher.submit(
                {
                    intent: "reorderTracks",
                    trackKeys: JSON.stringify(orderedTracks.map(t => t.key)),
                },
                {method: "post"},
            )
        }
    }

    // Show toast notifications for action results
    useEffect(() => {
        if (!actionData) return

        if (actionData.deleted) {
            toast.success("Track deleted successfully")
        } else if (actionData.success && actionData.message) {
            toast.success(actionData.message)
        } else if (actionData.error) {
            toast.error(actionData.error)
        }
    }, [actionData])

    // Show toast for reorder results - only when state transitions from loading to idle
    const prevReorderState = useRef(reorderFetcher.state)
    useEffect(() => {
        // Only show toast when transitioning from loading/submitting to idle
        if (
            prevReorderState.current !== "idle" &&
            reorderFetcher.state === "idle" &&
            reorderFetcher.data
        ) {
            if (reorderFetcher.data.reordered) {
                toast.success("Track order saved")
            } else if (reorderFetcher.data.error) {
                toast.error(reorderFetcher.data.error)
                // Revert to original order on error
                setOrderedTracks(tracks)
            }
        }
        prevReorderState.current = reorderFetcher.state
    }, [reorderFetcher.state, reorderFetcher.data, tracks])

    return (
        <div className="min-h-screen p-8">
            <div className="max-w-4xl mx-auto">
                <div className="mb-6">
                    <Link to="/" className="text-primary hover:underline">
                        &larr; Back to Cards
                    </Link>
                </div>

                <div className="flex gap-6 mb-8">
                    {card.coverUrl ? (
                        <img
                            src={card.coverUrl}
                            alt={card.title}
                            className="w-48 h-48 object-cover rounded-2xl shadow-md"
                        />
                    ) : (
                        <div className="w-48 h-48 bg-muted rounded-2xl flex items-center justify-center">
                            <span className="text-6xl text-muted-foreground">
                                ?
                            </span>
                        </div>
                    )}

                    <div className="flex-1">
                        <h1 className="text-3xl font-bold mb-2">
                            {card.title}
                        </h1>
                        <p className="text-muted-foreground">
                            {tracks.length} track
                            {tracks.length !== 1 ? "s" : ""}
                            {syncedCount > 0 && (
                                <span className="ml-2">
                                    ({syncedCount} from YouTube)
                                </span>
                            )}
                        </p>

                        {youtubePlaylistId && (
                            <p className="text-sm text-muted-foreground">
                                YouTube Playlist:{" "}
                                <a
                                    href={`https://www.youtube.com/playlist?list=${youtubePlaylistId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:underline"
                                >
                                    {youtubePlaylistId}
                                </a>
                            </p>
                        )}

                        {lastSynced && (
                            <p className="text-sm text-muted-foreground">
                                Last synced: {formatDate(lastSynced)}
                            </p>
                        )}

                        <div className="flex gap-2 mt-4">
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button
                                        variant="destructive"
                                        disabled={isBusy}
                                    >
                                        {isDeletingCard
                                            ? "Deleting..."
                                            : "Delete Card"}
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>
                                            Delete Card
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Are you sure you want to delete
                                            &ldquo;{card.title}&rdquo;? This
                                            will permanently remove the card and
                                            all its tracks from your Yoto
                                            account. This action cannot be
                                            undone.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>
                                            Cancel
                                        </AlertDialogCancel>
                                        <Form method="post">
                                            <input
                                                type="hidden"
                                                name="intent"
                                                value="deleteCard"
                                            />
                                            <AlertDialogAction
                                                type="submit"
                                                className="bg-destructive text-white hover:bg-destructive/90"
                                            >
                                                Delete
                                            </AlertDialogAction>
                                        </Form>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </div>
                </div>

                <Card>
                    <CardContent>
                        {orderedTracks.length === 0 ? (
                            <p className="text-muted-foreground text-center py-4">
                                No tracks on this card yet.
                            </p>
                        ) : (
                            <Reorder.Group
                                axis="y"
                                values={orderedTracks}
                                onReorder={handleReorder}
                                className="divide-y"
                            >
                                {orderedTracks.map((track, index) => (
                                    <Reorder.Item
                                        key={track.key}
                                        value={track}
                                        className="py-3 flex items-center gap-4 bg-background cursor-grab active:cursor-grabbing"
                                        onDragEnd={handleDragEnd}
                                        initial={{
                                            scale: 1,
                                            boxShadow: "none",
                                        }}
                                        whileDrag={{
                                            scale: 1.02,
                                            boxShadow:
                                                "0 4px 12px rgba(0, 0, 0, 0.15)",
                                            zIndex: 1,
                                        }}
                                        animate={{
                                            scale: 1,
                                            boxShadow: "none",
                                        }}
                                        transition={{
                                            duration: 0.2,
                                        }}
                                    >
                                        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                        <span className="text-muted-foreground w-8 text-right">
                                            {index + 1}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium truncate">
                                                {track.title}
                                            </p>
                                            {track.youtubeVideoId && (
                                                <p className="text-xs text-muted-foreground">
                                                    YouTube:{" "}
                                                    <a
                                                        href={`https://www.youtube.com/watch?v=${track.youtubeVideoId}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-primary hover:underline"
                                                    >
                                                        {track.youtubeVideoId}
                                                    </a>
                                                    {track.syncedAt && (
                                                        <span className="ml-2">
                                                            (synced{" "}
                                                            {formatDate(
                                                                track.syncedAt,
                                                            )}
                                                            )
                                                        </span>
                                                    )}
                                                </p>
                                            )}
                                        </div>
                                        {track.duration && (
                                            <span className="text-sm text-muted-foreground">
                                                {formatDuration(track.duration)}
                                            </span>
                                        )}
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-muted-foreground hover:text-destructive"
                                                    disabled={
                                                        isBusy || isReordering
                                                    }
                                                    aria-label={`Delete track: ${track.title}`}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>
                                                        Delete Track
                                                    </AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Are you sure you want to
                                                        delete &ldquo;
                                                        {track.title}&rdquo;?
                                                        This will remove the
                                                        track from the card.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>
                                                        Cancel
                                                    </AlertDialogCancel>
                                                    <Form method="post">
                                                        <input
                                                            type="hidden"
                                                            name="intent"
                                                            value="deleteTrack"
                                                        />
                                                        <input
                                                            type="hidden"
                                                            name="trackKey"
                                                            value={track.key}
                                                        />
                                                        <AlertDialogAction
                                                            type="submit"
                                                            className="bg-destructive text-white hover:bg-destructive/90"
                                                        >
                                                            Delete
                                                        </AlertDialogAction>
                                                    </Form>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </Reorder.Item>
                                ))}
                            </Reorder.Group>
                        )}
                    </CardContent>
                </Card>

                <AddTracksForm cardId={card.id} isBusy={isBusy} />
            </div>
        </div>
    )
}
