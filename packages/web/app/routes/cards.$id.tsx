import {Trash2} from "lucide-react"
import {redirect, useFetcher} from "react-router"
import {Link} from "react-router"

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
import {getAuthenticatedSdk, requireAuth} from "~/lib/auth.server"
import {stripNullValues} from "~/lib/sync-utils"
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

export default function CardDetail({
    loaderData,
}: {
    loaderData: Awaited<ReturnType<typeof loader>>
}) {
    const {card, tracks, syncedCount, youtubePlaylistId, lastSynced} =
        loaderData
    const fetcher = useFetcher()
    const isDeleting = fetcher.state !== "idle"

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
                        <p className="text-muted-foreground mb-4">
                            {tracks.length} track
                            {tracks.length !== 1 ? "s" : ""}
                            {syncedCount > 0 && (
                                <span className="ml-2">
                                    ({syncedCount} from YouTube)
                                </span>
                            )}
                        </p>

                        {youtubePlaylistId && (
                            <p className="text-sm text-muted-foreground mb-2">
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
                            <p className="text-sm text-muted-foreground mb-4">
                                Last synced: {formatDate(lastSynced)}
                            </p>
                        )}

                        <div className="flex gap-2">
                            <Link to={`/sync?cardId=${card.id}`}>
                                <Button>Sync More Content</Button>
                            </Link>

                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button
                                        variant="destructive"
                                        disabled={isDeleting}
                                    >
                                        {isDeleting
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
                                        <fetcher.Form method="post">
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
                                        </fetcher.Form>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Tracks</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {tracks.length === 0 ? (
                            <p className="text-muted-foreground text-center py-4">
                                No tracks on this card yet.
                            </p>
                        ) : (
                            <div className="divide-y">
                                {tracks.map((track, index) => (
                                    <div
                                        key={track.key || index}
                                        className="py-3 flex items-center gap-4"
                                    >
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
                                                    disabled={isDeleting}
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
                                                    <fetcher.Form method="post">
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
                                                    </fetcher.Form>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
