import {GripVertical, Trash2} from "lucide-react"
import {Reorder} from "motion/react"
import pLimit from "p-limit"
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

import {CARD_ASPECT_RATIO, CardCover} from "~/components/CardCover"
import {IconPickerContent, type IconSelection} from "~/components/IconPicker"
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "~/components/ui/dialog"
import {Input} from "~/components/ui/input"
import {Progress} from "~/components/ui/progress"
import {getAuthenticatedSdk, getToken, requireAuth} from "~/lib/auth.server"
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
import {fetchCommunityIconImage} from "~/lib/yotoicons-community.server"

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
                    display?: {icon16x16?: string} | null
                    tracks?: Array<{trackUrl?: string}>
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

        // Map mediaId to synced video info for display matching
        const mediaIdToVideo = new Map(
            syncedTracks?.videos.map(v => [v.mediaId, v]) ?? [],
        )

        const chapters = cardData.content?.chapters ?? []

        // Get cover URL - check metadata.cover first, then coverImageUrl as fallback
        const coverUrl =
            cardData.metadata?.cover?.imageL ??
            cardData.metadata?.cover?.imageM ??
            cardData.metadata?.cover?.imageS ??
            cardData.metadata?.coverImageUrl

        // Build tracks with icon media IDs
        const tracksWithIconIds = chapters.map(
            (chapter: {
                key?: string
                title?: string
                duration?: number
                display?: {icon16x16?: string} | null
                tracks?: Array<{trackUrl?: string}>
            }) => {
                // Match synced video by mediaId (extracted from chapter's trackUrl)
                const trackUrl = chapter.tracks?.[0]?.trackUrl
                const mediaId = trackUrl
                    ? sdk.extractMediaId(trackUrl)
                    : undefined
                const syncedVideo = mediaId
                    ? mediaIdToVideo.get(mediaId)
                    : undefined

                // Extract icon media ID from display.icon16x16 (format: "yoto:#mediaId")
                const iconMediaId = chapter.display?.icon16x16
                    ? (sdk.extractMediaId(chapter.display.icon16x16) ??
                      undefined)
                    : undefined
                return {
                    key: chapter.key ?? "",
                    title: chapter.title ?? "Untitled Track",
                    duration: chapter.duration,
                    youtubeVideoId: syncedVideo?.youtubeVideoId,
                    syncedAt: syncedVideo?.syncedAt,
                    iconMediaId,
                }
            },
        )

        // Resolve icon media IDs to signed URLs (limit concurrency to avoid rate limits)
        const limit = pLimit(5)
        const tracks = await Promise.all(
            tracksWithIconIds.map(track =>
                limit(async () => {
                    let iconUrl: string | undefined
                    if (track.iconMediaId) {
                        try {
                            iconUrl = await sdk.media.getMediaUrl(
                                cardId,
                                track.iconMediaId,
                            )
                        } catch {
                            // Ignore errors fetching icon URLs
                        }
                    }
                    return {
                        key: track.key,
                        title: track.title,
                        duration: track.duration,
                        youtubeVideoId: track.youtubeVideoId,
                        syncedAt: track.syncedAt,
                        iconUrl,
                    }
                }),
            ),
        )

        return {
            card: {
                id: cardData.cardId ?? cardId,
                title: cardData.title ?? "Untitled Card",
                coverUrl,
            },
            tracks,
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
                    chapters: Array<{
                        key?: string
                        tracks?: Array<{trackUrl?: string}>
                        [key: string]: unknown
                    }>
                    restricted: boolean
                    config: {onlineOnly: boolean}
                    version: string
                }
                metadata: Record<string, unknown>
            }

            // Find the chapter being deleted to extract its mediaId
            const chapterToDelete = card.content.chapters.find(
                chapter => chapter.key === trackKey,
            )
            const trackUrl = chapterToDelete?.tracks?.[0]?.trackUrl
            const mediaId = trackUrl ? sdk.extractMediaId(trackUrl) : undefined

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

            // Remove from local tracks.json (only if we have a mediaId)
            if (mediaId) {
                removeSyncedTrack(cardId, mediaId)
            }

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

        if (intent === "updateCover") {
            const coverFile = formData.get("coverFile") as File

            if (!coverFile || coverFile.size === 0) {
                return {error: "Cover image file is required"}
            }

            const token = await getToken()

            if (!token) {
                return {error: "Authentication required to upload cover"}
            }

            const imageBuffer = Buffer.from(await coverFile.arrayBuffer())

            const url = new URL(
                "https://api.yotoplay.com/media/coverImage/user/me/upload",
            )
            url.searchParams.set("autoconvert", "true")
            url.searchParams.set("coverType", "default")

            const uploadResponse = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": coverFile.type,
                },
                body: new Uint8Array(imageBuffer),
            })

            if (!uploadResponse.ok) {
                return {
                    error: `Cover upload failed: ${uploadResponse.statusText}`,
                }
            }

            const uploadResult = (await uploadResponse.json()) as {
                coverImage: {mediaId: string; mediaUrl: string}
            }

            const {mediaUrl} = uploadResult.coverImage

            // Get current card and update cover metadata
            const card = (await sdk.content.getCard(cardId)) as unknown as {
                cardId: string
                title?: string
                content: Record<string, unknown>
                metadata: Record<string, unknown> & {
                    cover?: {imageL?: string; imageM?: string; imageS?: string}
                }
            }

            const updatedCard = {
                cardId,
                title: card.title,
                content: card.content,
                metadata: {
                    ...card.metadata,
                    cover: {
                        ...card.metadata?.cover,
                        imageL: mediaUrl,
                    },
                },
            }

            await sdk.content.updateCard(
                updatedCard as unknown as Parameters<
                    typeof sdk.content.updateCard
                >[0],
            )

            return {success: true, coverUpdated: true}
        }

        if (intent === "updateTrackIcon") {
            const trackKey = formData.get("trackKey") as string
            const iconId = formData.get("iconId") as string
            const iconType =
                (formData.get("iconType") as "yoto" | "community") ?? "yoto"

            if (!trackKey || !iconId) {
                return {error: "Track key and icon ID are required"}
            }

            let mediaId: string

            if (iconType === "yoto") {
                // Yoto icons: hash IS the media ID (already 43-char base64url)
                mediaId = iconId
            } else {
                // Community icons: fetch PNG, upload to Yoto via custom icon endpoint
                const imageBuffer = await fetchCommunityIconImage(iconId)
                const token = await getToken()

                if (!token) {
                    return {error: "Authentication required to upload icons"}
                }

                const uploadResponse = await fetch(
                    `https://api.yotoplay.com/media/displayIcons/user/me/upload?autoConvert=true&filename=${iconId}.png`,
                    {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${token}`,
                            "Content-Type": "image/png",
                        },
                        body: new Uint8Array(imageBuffer),
                    },
                )

                if (!uploadResponse.ok) {
                    return {
                        error: `Icon upload failed: ${uploadResponse.statusText}`,
                    }
                }

                const uploadResult = (await uploadResponse.json()) as {
                    displayIcon: {mediaId: string}
                }

                mediaId = uploadResult.displayIcon.mediaId
            }

            // Get current card
            const card = (await sdk.content.getCard(cardId)) as unknown as {
                cardId: string
                title?: string
                content: {
                    activity: string
                    chapters: Array<{
                        key?: string
                        display?: {icon16x16?: string} | null
                        [key: string]: unknown
                    }>
                    restricted: boolean
                    config: {onlineOnly: boolean}
                    version: string
                }
                metadata: Record<string, unknown>
            }

            // Find and update the chapter's icon (both chapter-level and track-level)
            const updatedChapters = card.content.chapters.map(chapter => {
                if (chapter.key === trackKey) {
                    const chapterWithIcon = chapter as typeof chapter & {
                        tracks?: Array<{
                            display?: {icon16x16?: string} | null
                            [key: string]: unknown
                        }>
                    }

                    // Update tracks display if present
                    const updatedTracks = chapterWithIcon.tracks?.map(
                        track => ({
                            ...track,
                            display: {
                                ...track.display,
                                icon16x16: `yoto:#${mediaId}`,
                            },
                        }),
                    )

                    return {
                        ...chapter,
                        display: {
                            ...chapter.display,
                            icon16x16: `yoto:#${mediaId}`,
                        },
                        ...(updatedTracks && {tracks: updatedTracks}),
                    }
                }
                return chapter
            })

            // Update card with new icon
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

            return {success: true, iconUpdated: true}
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
    iconUpdated?: boolean
    coverUpdated?: boolean
}

type Track = {
    key: string
    title: string
    duration?: number
    youtubeVideoId?: string
    syncedAt?: string
    iconUrl?: string
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
    const iconFetcher = useFetcher<ActionData>()
    const coverFetcher = useFetcher<ActionData>()

    // Local state for optimistic reordering
    const [orderedTracks, setOrderedTracks] = useState<Track[]>(tracks)
    const hasOrderChangedRef = useRef(false)

    // State for cover upload dialog
    const [coverDialogOpen, setCoverDialogOpen] = useState(false)
    const [coverPreview, setCoverPreview] = useState<string | null>(null)
    const coverFileRef = useRef<HTMLInputElement>(null)

    // State for icon picker modal
    const [selectedTrackKey, setSelectedTrackKey] = useState<string | null>(
        null,
    )

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

    // Show toast for icon update results and close dialog on completion
    const prevIconState = useRef(iconFetcher.state)
    useEffect(() => {
        if (
            prevIconState.current !== "idle" &&
            iconFetcher.state === "idle" &&
            iconFetcher.data
        ) {
            if (iconFetcher.data.iconUpdated) {
                toast.success("Icon updated")
            } else if (iconFetcher.data.error) {
                toast.error(iconFetcher.data.error)
            }
            setSelectedTrackKey(null)
        }
        prevIconState.current = iconFetcher.state
    }, [iconFetcher.state, iconFetcher.data])

    // Show toast for cover update results and close dialog on completion
    const prevCoverState = useRef(coverFetcher.state)
    useEffect(() => {
        if (
            prevCoverState.current !== "idle" &&
            coverFetcher.state === "idle" &&
            coverFetcher.data
        ) {
            if (coverFetcher.data.coverUpdated) {
                toast.success("Cover image updated")
            } else if (coverFetcher.data.error) {
                toast.error(coverFetcher.data.error)
            }
            setCoverDialogOpen(false)
        }
        prevCoverState.current = coverFetcher.state
    }, [coverFetcher.state, coverFetcher.data])

    // Handle icon selection from picker
    const handleIconSelect = (icon: IconSelection) => {
        if (!selectedTrackKey) return

        iconFetcher.submit(
            {
                intent: "updateTrackIcon",
                trackKey: selectedTrackKey,
                iconId: icon.id,
                iconType: icon.type,
            },
            {method: "post"},
        )
    }

    return (
        <div className="min-h-screen p-8">
            <div className="max-w-4xl mx-auto">
                <div className="mb-6">
                    <Link to="/" className="text-primary hover:underline">
                        &larr; Back to Cards
                    </Link>
                </div>

                <div className="flex gap-6 mb-8">
                    <Dialog
                        open={coverDialogOpen}
                        onOpenChange={open => {
                            if (!open && coverFetcher.state !== "idle") return
                            setCoverDialogOpen(open)
                            if (open) {
                                setCoverPreview(null)
                                if (coverFileRef.current) {
                                    coverFileRef.current.value = ""
                                }
                            }
                        }}
                    >
                        <DialogTrigger asChild>
                            <button
                                type="button"
                                className="w-48 shrink-0 cursor-pointer"
                                aria-label="Change cover image"
                            >
                                <CardCover
                                    coverUrl={card.coverUrl}
                                    title={card.title}
                                />
                            </button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>Change Cover Image</DialogTitle>
                                <DialogDescription>
                                    Upload a new cover image for this card.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                                {coverPreview && (
                                    <div className="w-32 mx-auto">
                                        <div
                                            className={`${CARD_ASPECT_RATIO} rounded-2xl overflow-hidden shadow-md`}
                                        >
                                            <img
                                                src={coverPreview}
                                                alt="Cover preview"
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    </div>
                                )}
                                <Input
                                    ref={coverFileRef}
                                    type="file"
                                    accept="image/*"
                                    disabled={coverFetcher.state !== "idle"}
                                    onChange={e => {
                                        const file = e.target.files?.[0]
                                        if (file) {
                                            const url =
                                                URL.createObjectURL(file)
                                            setCoverPreview(url)
                                        } else {
                                            setCoverPreview(null)
                                        }
                                    }}
                                />
                                <Button
                                    disabled={
                                        !coverPreview ||
                                        coverFetcher.state !== "idle"
                                    }
                                    className="w-full"
                                    onClick={() => {
                                        const file =
                                            coverFileRef.current?.files?.[0]
                                        if (!file) return

                                        const formData = new FormData()
                                        formData.set("intent", "updateCover")
                                        formData.set("coverFile", file)

                                        coverFetcher.submit(formData, {
                                            method: "post",
                                            encType: "multipart/form-data",
                                        })
                                    }}
                                >
                                    {coverFetcher.state !== "idle"
                                        ? "Uploading..."
                                        : "Upload"}
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>

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
                                        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                                        <span className="text-muted-foreground w-8 text-right">
                                            {index + 1}
                                        </span>
                                        <Dialog
                                            open={
                                                selectedTrackKey === track.key
                                            }
                                            onOpenChange={(open: boolean) => {
                                                if (
                                                    !open &&
                                                    iconFetcher.state !== "idle"
                                                )
                                                    return
                                                if (open) {
                                                    setSelectedTrackKey(
                                                        track.key,
                                                    )
                                                } else {
                                                    setSelectedTrackKey(null)
                                                }
                                            }}
                                        >
                                            <DialogTrigger asChild>
                                                <button
                                                    type="button"
                                                    className="shrink-0 p-2 rounded-md bg-zinc-900 hover:bg-zinc-700 transition-colors"
                                                    aria-label={`Change icon for ${track.title}`}
                                                >
                                                    {track.iconUrl ? (
                                                        <img
                                                            src={track.iconUrl}
                                                            alt=""
                                                            className="w-8 h-8"
                                                            style={{
                                                                imageRendering:
                                                                    "pixelated",
                                                            }}
                                                        />
                                                    ) : (
                                                        <div className="w-8 h-8 bg-zinc-700 rounded" />
                                                    )}
                                                </button>
                                            </DialogTrigger>
                                            <DialogContent className="sm:max-w-lg">
                                                <IconPickerContent
                                                    onSelect={handleIconSelect}
                                                />
                                            </DialogContent>
                                        </Dialog>
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
