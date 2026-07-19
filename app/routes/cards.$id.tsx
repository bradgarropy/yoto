import {Copy, ListChecks, ListOrdered, Plus, Trash2, X} from "lucide-react"
import {Reorder} from "motion/react"
import {useEffect, useRef, useState} from "react"
import {
    Form,
    Link,
    redirect,
    useActionData,
    useFetcher,
    useNavigation,
} from "react-router"
import {toast} from "sonner"

import {AddTracksDialog} from "~/components/AddTracksDialog"
import {CARD_ASPECT_RATIO, CardCover} from "~/components/CardCover"
import {CopyTrackDialog} from "~/components/CopyTrackDialog"
import {EditableTitle} from "~/components/EditableTitle"
import {IconPickerContent, type IconSelection} from "~/components/IconPicker"
import {type Track, TrackItem} from "~/components/TrackItem"
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
import {Card, CardContent} from "~/components/ui/card"
import {Checkbox} from "~/components/ui/checkbox"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "~/components/ui/dialog"
import {Input} from "~/components/ui/input"
import {getToken} from "~/lib/auth.server"
import {getCardCoverUrl} from "~/lib/card-utils"
import {cloudflareContext} from "~/lib/cloudflare-context"
import {getNextChapterKey, stripNullValues} from "~/lib/import-utils"
import {EVENT, telemetry} from "~/lib/telemetry.server"
import type {CardData} from "~/lib/types"
import {parseFormData} from "~/lib/validation.server"
import {getNumberIcons, getYotoIconUrlMap} from "~/lib/yoto-icons.server"
import {fetchCommunityIconImage} from "~/lib/yotoicons-community.server"
import {authContext} from "~/middleware/auth.server"
import {trackKeysSchema, updateTitleSchema} from "~/schemas/card"

import type {Route} from "./+types/cards.$id"

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

export async function loader({params, request, context}: Route.LoaderArgs) {
    const cardId = params.id
    const {sdk} = context.get(authContext)
    const {env} = context.get(cloudflareContext)

    try {
        // Fetch current card and all cards in parallel
        const [card, allCards] = await Promise.all([
            sdk.content.getCard(cardId),
            sdk.content.getMyCards(),
        ])

        // Build other cards list (excluding current card)
        const otherCards = allCards
            .filter(c => c.cardId !== cardId)
            .map(c => ({
                id: c.cardId,
                title: c.title ?? "Untitled Card",
                coverUrl: getCardCoverUrl(c),
            }))

        // Type assertion for SDK response - getCard returns the card directly
        const cardData = card as unknown as CardData

        if (!cardData) {
            throw new Error("Card not found")
        }

        const chapters = cardData.content?.chapters ?? []

        const coverUrl = getCardCoverUrl(cardData)
        const yotoIconUrls = await getYotoIconUrlMap(request, env).catch(
            () => new Map<string, string>(),
        )

        // Build tracks with icon media IDs
        const tracksWithIconIds = chapters.map(
            (chapter: {
                key?: string
                title?: string
                duration?: number
                display?: {icon16x16?: string} | null
                tracks?: Array<{trackUrl?: string}>
            }) => {
                // Extract icon media ID from display.icon16x16 (format: "yoto:#mediaId")
                const iconMediaId = chapter.display?.icon16x16
                    ? (sdk.extractMediaId(chapter.display.icon16x16) ??
                      undefined)
                    : undefined
                return {
                    key: chapter.key ?? "",
                    title: chapter.title ?? "Untitled Track",
                    duration: chapter.duration,
                    iconMediaId,
                }
            },
        )

        const tracks = tracksWithIconIds.map(track => ({
            key: track.key,
            title: track.title,
            duration: track.duration,
            iconUrl: track.iconMediaId
                ? yotoIconUrls.get(track.iconMediaId)
                : undefined,
        }))

        return {
            card: {
                id: cardData.cardId ?? cardId,
                title: cardData.title ?? "Untitled Card",
                coverUrl,
            },
            tracks,
            otherCards,
        }
    } catch (error) {
        console.error("Failed to fetch card:", error)
        throw new Response("Card not found", {status: 404})
    }
}

type TrackOperation = "copy" | "delete"

const TRACK_EVENT = {
    copy: {
        completed: EVENT.TRACK.COPY.COMPLETED,
        failed: EVENT.TRACK.COPY.FAILED,
    },
    delete: {
        completed: EVENT.TRACK.DELETE.COMPLETED,
        failed: EVENT.TRACK.DELETE.FAILED,
    },
} as const

const getTrackOperation = (
    intent: FormDataEntryValue | null,
): TrackOperation | null => {
    if (intent === "copyTrack" || intent === "copyTracks") return "copy"
    if (intent === "deleteTrack" || intent === "deleteTracks") return "delete"
    return null
}

const getTrackKeys = (formData: FormData): string[] => {
    const trackKey = formData.get("trackKey")
    if (typeof trackKey === "string" && trackKey) return [trackKey]

    const trackKeys = formData.get("trackKeys")
    if (typeof trackKeys !== "string") return []

    try {
        const parsed = JSON.parse(trackKeys)
        return Array.isArray(parsed)
            ? parsed.filter(value => typeof value === "string")
            : []
    } catch {
        return []
    }
}

function createTrackOperationTelemetry({
    cardId,
    formData,
    intent,
    startedAt,
}: {
    cardId: string
    formData: FormData
    intent: FormDataEntryValue | null
    startedAt: number
}) {
    const operation = getTrackOperation(intent)
    if (!operation) return null

    const trackKeys = getTrackKeys(formData)
    const requestedCount = trackKeys.length
    const destinationCardId = formData.get("destinationCardId")
    const basePayload = {
        cardId,
        ...(typeof destinationCardId === "string" &&
            destinationCardId && {destinationCardId}),
        trackKeys,
        requestedCount,
    }

    return {
        completed(succeededCount = requestedCount) {
            telemetry.info(TRACK_EVENT[operation].completed, {
                ...basePayload,
                succeededCount,
                failedCount: requestedCount - succeededCount,
                durationMs: Date.now() - startedAt,
            })
        },
        failed(reason: string, level: "warn" | "error" = "warn") {
            const payload = {
                ...basePayload,
                succeededCount: 0,
                failedCount: requestedCount,
                reason,
                durationMs: Date.now() - startedAt,
            }

            if (level === "error") {
                telemetry.error(TRACK_EVENT[operation].failed, payload)
            } else {
                telemetry.warn(TRACK_EVENT[operation].failed, payload)
            }
        },
    }
}

export async function action({params, request, context}: Route.ActionArgs) {
    const startedAt = Date.now()
    const cardId = params.id
    const formData = await request.formData()
    const intent = formData.get("intent")
    const trackTelemetry = createTrackOperationTelemetry({
        cardId,
        formData,
        intent,
        startedAt,
    })

    // Get env from Cloudflare context
    const {env} = context.get(cloudflareContext)

    try {
        const {sdk} = context.get(authContext)

        if (intent === "deleteTrack") {
            const trackKey = formData.get("trackKey") as string

            if (!trackKey) {
                trackTelemetry?.failed("invalid_request")
                return {error: "Track key is required"}
            }

            // Get current card
            const card = (await sdk.content.getCard(
                cardId,
            )) as unknown as CardData

            // Filter out the track to delete
            const updatedChapters = card.content.chapters.filter(
                chapter => chapter.key !== trackKey,
            )

            if (updatedChapters.length === card.content.chapters.length) {
                trackTelemetry?.failed("track_not_found")
                return {error: "Track not found"}
            }

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

            trackTelemetry?.completed()
            return {success: true, deleted: trackKey}
        }

        if (intent === "deleteTracks") {
            const trackKeysJson = formData.get("trackKeys")

            if (typeof trackKeysJson !== "string") {
                trackTelemetry?.failed("invalid_request")
                return {error: "Track keys are required"}
            }

            let trackKeys: unknown

            try {
                trackKeys = JSON.parse(trackKeysJson)
            } catch {
                trackTelemetry?.failed("invalid_request")
                return {error: "Invalid track keys"}
            }

            const result = trackKeysSchema.safeParse(trackKeys)

            if (!result.success) {
                trackTelemetry?.failed("invalid_request")
                return {
                    error:
                        result.error.issues[0]?.message ?? "Invalid track keys",
                }
            }

            const selectedTrackKeys = new Set(result.data)
            const card = (await sdk.content.getCard(
                cardId,
            )) as unknown as CardData
            const updatedChapters = card.content.chapters.filter(
                chapter => !chapter.key || !selectedTrackKeys.has(chapter.key),
            )
            const deletedCount =
                card.content.chapters.length - updatedChapters.length

            if (deletedCount === 0) {
                trackTelemetry?.failed("tracks_not_found")
                return {error: "Selected tracks were not found"}
            }

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

            trackTelemetry?.completed(deletedCount)
            return {success: true, deletedCount}
        }

        if (intent === "copyTrack") {
            const trackKey = formData.get("trackKey") as string
            const destinationCardId = formData.get(
                "destinationCardId",
            ) as string

            if (!trackKey) {
                trackTelemetry?.failed("invalid_request")
                return {error: "Track key is required"}
            }

            if (!destinationCardId) {
                trackTelemetry?.failed("invalid_request")
                return {error: "Destination card is required"}
            }

            if (destinationCardId === cardId) {
                trackTelemetry?.failed("same_card")
                return {error: "Cannot copy a track to the same card"}
            }

            // Fetch source and destination cards in parallel
            const [sourceCard, destCard] = await Promise.all([
                sdk.content.getCard(cardId),
                sdk.content.getCard(destinationCardId),
            ])

            const sourceCardData = sourceCard as unknown as CardData
            const destCardData = destCard as unknown as CardData

            // Find the chapter to copy from the source card
            const chapterToCopy = sourceCardData.content.chapters.find(
                chapter => chapter.key === trackKey,
            )

            if (!chapterToCopy) {
                trackTelemetry?.failed("track_not_found")
                return {error: "Track not found on source card"}
            }

            // Generate the next chapter key based on existing keys
            const destChapters = destCardData.content.chapters
            const nextKey = getNextChapterKey(destChapters)

            // Append the copied chapter with a new key
            const copiedChapter = {...chapterToCopy, key: nextKey}
            const updatedChapters = [
                ...stripNullValues(destChapters),
                stripNullValues(copiedChapter),
            ]

            // Update the destination card
            const updatedDestCard = {
                cardId: destinationCardId,
                title: destCardData.title,
                content: {
                    ...destCardData.content,
                    chapters: updatedChapters,
                },
                metadata: destCardData.metadata,
            }

            await sdk.content.updateCard(
                updatedDestCard as unknown as Parameters<
                    typeof sdk.content.updateCard
                >[0],
            )

            trackTelemetry?.completed()
            return {
                success: true,
                copied: true,
                destinationCardTitle: destCardData.title ?? "Untitled Card",
            }
        }

        if (intent === "copyTracks") {
            const trackKeysJson = formData.get("trackKeys")
            const destinationCardId = formData.get("destinationCardId")

            if (typeof trackKeysJson !== "string") {
                trackTelemetry?.failed("invalid_request")
                return {error: "Track keys are required"}
            }

            if (typeof destinationCardId !== "string" || !destinationCardId) {
                trackTelemetry?.failed("invalid_request")
                return {error: "Destination card is required"}
            }

            if (destinationCardId === cardId) {
                trackTelemetry?.failed("same_card")
                return {error: "Cannot copy tracks to the same card"}
            }

            let trackKeys: unknown

            try {
                trackKeys = JSON.parse(trackKeysJson)
            } catch {
                trackTelemetry?.failed("invalid_request")
                return {error: "Invalid track keys"}
            }

            const result = trackKeysSchema.safeParse(trackKeys)

            if (!result.success) {
                trackTelemetry?.failed("invalid_request")
                return {
                    error:
                        result.error.issues[0]?.message ?? "Invalid track keys",
                }
            }

            const [sourceCard, destinationCard] = await Promise.all([
                sdk.content.getCard(cardId),
                sdk.content.getCard(destinationCardId),
            ])
            const sourceCardData = sourceCard as unknown as CardData
            const destinationCardData = destinationCard as unknown as CardData
            const selectedTrackKeys = new Set(result.data)
            const chaptersToCopy = sourceCardData.content.chapters.filter(
                chapter => chapter.key && selectedTrackKeys.has(chapter.key),
            )

            if (chaptersToCopy.length !== selectedTrackKeys.size) {
                trackTelemetry?.failed("tracks_not_found")
                return {error: "One or more selected tracks were not found"}
            }

            const updatedChapters = [
                ...stripNullValues(destinationCardData.content.chapters),
            ]

            for (const chapter of chaptersToCopy) {
                updatedChapters.push(
                    stripNullValues({
                        ...chapter,
                        key: getNextChapterKey(updatedChapters),
                    }),
                )
            }

            const updatedDestinationCard = {
                cardId: destinationCardId,
                title: destinationCardData.title,
                content: {
                    ...destinationCardData.content,
                    chapters: updatedChapters,
                },
                metadata: destinationCardData.metadata,
            }

            await sdk.content.updateCard(
                updatedDestinationCard as unknown as Parameters<
                    typeof sdk.content.updateCard
                >[0],
            )

            trackTelemetry?.completed(chaptersToCopy.length)
            return {
                success: true,
                copied: true,
                copiedCount: chaptersToCopy.length,
                destinationCardTitle:
                    destinationCardData.title ?? "Untitled Card",
            }
        }

        if (intent === "deleteCard") {
            await sdk.content.deleteCard(cardId)

            return redirect("/cards")
        }

        if (intent === "reorderTracks") {
            const trackKeys = getTrackKeys(formData)
            const telemetryPayload = {
                cardId,
                trackKeys,
                trackCount: trackKeys.length,
                durationMs: Date.now() - startedAt,
            }
            const result = trackKeysSchema.safeParse(trackKeys)

            if (!result.success) {
                telemetry.warn(EVENT.TRACK.REORDER.FAILED, {
                    ...telemetryPayload,
                    reason: "invalid_request",
                })
                return {error: "Track keys are required"}
            }

            const newOrder = result.data

            // Get current card
            const card = (await sdk.content.getCard(
                cardId,
            )) as unknown as CardData

            // Create a map of key -> chapter for reordering
            const chapterMap = new Map(
                card.content.chapters.map(chapter => [chapter.key, chapter]),
            )

            if (
                newOrder.length !== card.content.chapters.length ||
                newOrder.some(key => !chapterMap.has(key))
            ) {
                telemetry.warn(EVENT.TRACK.REORDER.FAILED, {
                    ...telemetryPayload,
                    reason: "tracks_not_found",
                    durationMs: Date.now() - startedAt,
                })
                return {error: "One or more tracks were not found"}
            }

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

            telemetry.info(EVENT.TRACK.REORDER.COMPLETED, {
                ...telemetryPayload,
                durationMs: Date.now() - startedAt,
            })
            return {success: true, reordered: true}
        }

        if (intent === "updateCover") {
            const coverFile = formData.get("coverFile") as File

            if (!coverFile || coverFile.size === 0) {
                return {error: "Cover image file is required"}
            }

            const MAX_COVER_SIZE = 10 * 1024 * 1024 // 10MB
            if (coverFile.size > MAX_COVER_SIZE) {
                return {error: "Cover image must be under 10MB"}
            }

            const ALLOWED_IMAGE_TYPES = [
                "image/jpeg",
                "image/png",
                "image/gif",
                "image/webp",
            ]
            if (!ALLOWED_IMAGE_TYPES.includes(coverFile.type)) {
                return {error: "Cover image must be a JPEG, PNG, GIF, or WebP"}
            }

            const tokenResult = await getToken(request, env)

            if (!tokenResult) {
                return {error: "Authentication required to upload cover"}
            }

            const imageBuffer = new Uint8Array(await coverFile.arrayBuffer())

            const url = new URL(
                "https://api.yotoplay.com/media/coverImage/user/me/upload",
            )
            url.searchParams.set("autoconvert", "true")
            url.searchParams.set("coverType", "default")

            const uploadResponse = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${tokenResult.token}`,
                    "Content-Type": coverFile.type,
                },
                body: imageBuffer,
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
            const card = (await sdk.content.getCard(
                cardId,
            )) as unknown as CardData

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
            const requestedIconType = formData.get("iconType")
            const iconType: "yoto" | "community" =
                requestedIconType === "community" ? "community" : "yoto"
            const telemetryPayload = {
                cardId,
                trackKey: trackKey ?? "",
                iconType,
                durationMs: Date.now() - startedAt,
            }

            if (!trackKey || !iconId) {
                telemetry.warn(EVENT.TRACK.ICON.FAILED, {
                    ...telemetryPayload,
                    reason: "invalid_request",
                })
                return {error: "Track key and icon ID are required"}
            }

            let mediaId: string

            if (iconType === "yoto") {
                // Yoto icons: hash IS the media ID (already 43-char base64url)
                mediaId = iconId
            } else {
                // Community icons: fetch PNG, upload to Yoto via custom icon endpoint
                const imageBuffer = await fetchCommunityIconImage(iconId)
                const iconTokenResult = await getToken(request, env)

                if (!iconTokenResult) {
                    telemetry.warn(EVENT.TRACK.ICON.FAILED, {
                        ...telemetryPayload,
                        reason: "authentication_required",
                        durationMs: Date.now() - startedAt,
                    })
                    return {error: "Authentication required to upload icons"}
                }

                const uploadResponse = await fetch(
                    `https://api.yotoplay.com/media/displayIcons/user/me/upload?autoConvert=true&filename=${iconId}.png`,
                    {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${iconTokenResult.token}`,
                            "Content-Type": "image/png",
                        },
                        body: imageBuffer.buffer as ArrayBuffer,
                    },
                )

                if (!uploadResponse.ok) {
                    telemetry.error(EVENT.TRACK.ICON.FAILED, {
                        ...telemetryPayload,
                        reason: `upload_failed_${uploadResponse.status}`,
                        durationMs: Date.now() - startedAt,
                    })
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
            const card = (await sdk.content.getCard(
                cardId,
            )) as unknown as CardData

            if (
                !card.content.chapters.some(chapter => chapter.key === trackKey)
            ) {
                telemetry.warn(EVENT.TRACK.ICON.FAILED, {
                    ...telemetryPayload,
                    reason: "track_not_found",
                    durationMs: Date.now() - startedAt,
                })
                return {error: "Track not found"}
            }

            // Find and update the chapter's icon (both chapter-level and track-level)
            const updatedChapters = card.content.chapters.map(chapter => {
                if (chapter.key === trackKey) {
                    // Update tracks display if present
                    const updatedTracks = chapter.tracks?.map(track => ({
                        ...track,
                        display: {
                            ...track.display,
                            icon16x16: `yoto:#${mediaId}`,
                        },
                    }))

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

            telemetry.info(EVENT.TRACK.ICON.COMPLETED, {
                ...telemetryPayload,
                durationMs: Date.now() - startedAt,
            })
            return {success: true, iconUpdated: true}
        }

        if (intent === "numberTracks") {
            const numberIcons = await getNumberIcons(request, env)

            if (numberIcons.size === 0) {
                return {error: "Could not find number icons"}
            }

            // Get current card
            const card = (await sdk.content.getCard(
                cardId,
            )) as unknown as CardData

            const updatedChapters = card.content.chapters.map(
                (chapter, index) => {
                    const position = index + 1
                    const mediaId = numberIcons.get(position)

                    // Leave unchanged if no number icon for this position
                    if (!mediaId) return chapter

                    const updatedTracks = chapter.tracks?.map(track => ({
                        ...track,
                        display: {
                            ...track.display,
                            icon16x16: `yoto:#${mediaId}`,
                        },
                    }))

                    return {
                        ...chapter,
                        display: {
                            ...chapter.display,
                            icon16x16: `yoto:#${mediaId}`,
                        },
                        ...(updatedTracks && {tracks: updatedTracks}),
                    }
                },
            )

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

            return {success: true, tracksNumbered: true}
        }

        if (intent === "updateTitle") {
            const result = parseFormData(formData, updateTitleSchema)

            if (!result.success) {
                const error = result.error.issues[0]?.message ?? "Invalid title"
                return {error}
            }

            const {title} = result.data

            const card = (await sdk.content.getCard(
                cardId,
            )) as unknown as CardData

            const updatedCard = {
                cardId,
                title,
                content: card.content,
                metadata: card.metadata,
            }

            await sdk.content.updateCard(
                updatedCard as unknown as Parameters<
                    typeof sdk.content.updateCard
                >[0],
            )

            return {success: true, titleUpdated: true}
        }

        return {error: "Invalid intent"}
    } catch (error) {
        trackTelemetry?.failed("operation_failed", "error")

        if (intent === "reorderTracks") {
            const trackKeys = getTrackKeys(formData)
            telemetry.error(EVENT.TRACK.REORDER.FAILED, {
                cardId,
                trackKeys,
                trackCount: trackKeys.length,
                reason: "operation_failed",
                durationMs: Date.now() - startedAt,
            })
        }

        if (intent === "updateTrackIcon") {
            const trackKey = formData.get("trackKey")
            telemetry.error(EVENT.TRACK.ICON.FAILED, {
                cardId,
                trackKey: typeof trackKey === "string" ? trackKey : "",
                iconType:
                    formData.get("iconType") === "community"
                        ? "community"
                        : "yoto",
                reason: "operation_failed",
                durationMs: Date.now() - startedAt,
            })
        }

        console.error("Failed to perform action:", error)
        return {error: "Operation failed"}
    }
}

export type ActionData = {
    error?: string
    success?: boolean
    message?: string
    added?: number
    skipped?: number
    deleted?: string
    deletedCount?: number
    reordered?: boolean
    iconUpdated?: boolean
    coverUpdated?: boolean
    tracksNumbered?: boolean
    copied?: boolean
    copiedCount?: number
    destinationCardTitle?: string
    titleUpdated?: boolean
}

export default function CardDetail({
    loaderData,
}: {
    loaderData: Awaited<ReturnType<typeof loader>>
}) {
    const {card, tracks, otherCards} = loaderData
    const navigation = useNavigation()
    const actionData = useActionData<ActionData>()
    const reorderFetcher = useFetcher<ActionData>()
    const iconFetcher = useFetcher<ActionData>()
    const coverFetcher = useFetcher<ActionData>()
    const numberFetcher = useFetcher<ActionData>()
    const copyFetcher = useFetcher<ActionData>()
    const titleFetcher = useFetcher<ActionData>()

    // Local state for optimistic reordering
    const [orderedTracks, setOrderedTracks] = useState<Track[]>(tracks)
    const [selectedTrackKeys, setSelectedTrackKeys] = useState<Set<string>>(
        () => new Set(),
    )
    const [isSelectingTracks, setIsSelectingTracks] = useState(false)
    const hasOrderChangedRef = useRef(false)
    const trackKeys = tracks.map(track => track.key).join("\0")

    // State for cover upload dialog
    const [coverDialogOpen, setCoverDialogOpen] = useState(false)
    const [coverPreview, setCoverPreview] = useState<string | null>(null)
    const coverFileRef = useRef<HTMLInputElement>(null)

    // Revoke cover preview URL on unmount
    useEffect(() => {
        return () => {
            if (coverPreview) {
                URL.revokeObjectURL(coverPreview)
            }
        }
    }, [coverPreview])

    // State for icon picker modal
    const [selectedTrackKey, setSelectedTrackKey] = useState<string | null>(
        null,
    )

    // State for add tracks dialog
    const [addTracksDialogOpen, setAddTracksDialogOpen] = useState(false)

    // State for copy track dialog
    const [copyTrackKeys, setCopyTrackKeys] = useState<string[]>([])

    // Sync local state with loader data when it changes
    useEffect(() => {
        setOrderedTracks(tracks)
        hasOrderChangedRef.current = false
    }, [tracks])

    useEffect(() => {
        setSelectedTrackKeys(new Set())
    }, [trackKeys])

    const isReordering = reorderFetcher.state !== "idle"
    const isNumbering = numberFetcher.state !== "idle"
    const isBusy =
        navigation.state !== "idle" ||
        isReordering ||
        isNumbering ||
        iconFetcher.state !== "idle" ||
        coverFetcher.state !== "idle" ||
        titleFetcher.state !== "idle"
    const pendingIntent = navigation.formData?.get("intent")
    const isDeletingCard = pendingIntent === "deleteCard"
    const selectedTrackCount = selectedTrackKeys.size
    const allTracksSelected =
        orderedTracks.length > 0 && selectedTrackCount === orderedTracks.length
    const someTracksSelected = selectedTrackCount > 0 && !allTracksSelected

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

        if (actionData.deletedCount) {
            toast.success(
                `${actionData.deletedCount} track${
                    actionData.deletedCount === 1 ? "" : "s"
                } deleted successfully`,
            )
            setSelectedTrackKeys(new Set())
            setIsSelectingTracks(false)
        } else if (actionData.deleted) {
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
                setSelectedTrackKey(null)
            } else if (iconFetcher.data.error) {
                toast.error(iconFetcher.data.error)
            }
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
                setCoverDialogOpen(false)
            } else if (coverFetcher.data.error) {
                toast.error(coverFetcher.data.error)
            }
        }
        prevCoverState.current = coverFetcher.state
    }, [coverFetcher.state, coverFetcher.data])

    // Show toast for number tracks results
    const prevNumberState = useRef(numberFetcher.state)
    useEffect(() => {
        if (
            prevNumberState.current !== "idle" &&
            numberFetcher.state === "idle" &&
            numberFetcher.data
        ) {
            if (numberFetcher.data.tracksNumbered) {
                toast.success("Track icons numbered")
            } else if (numberFetcher.data.error) {
                toast.error(numberFetcher.data.error)
            }
        }
        prevNumberState.current = numberFetcher.state
    }, [numberFetcher.state, numberFetcher.data])

    // Show toast for copy track results and close dialog on completion
    const prevCopyState = useRef(copyFetcher.state)
    useEffect(() => {
        if (
            prevCopyState.current !== "idle" &&
            copyFetcher.state === "idle" &&
            copyFetcher.data
        ) {
            if (copyFetcher.data.copied) {
                const copiedCount = copyFetcher.data.copiedCount ?? 1
                toast.success(
                    copiedCount === 1
                        ? `Track copied to ${copyFetcher.data.destinationCardTitle}`
                        : `${copiedCount} tracks copied to ${copyFetcher.data.destinationCardTitle}`,
                )
                setCopyTrackKeys([])
                setSelectedTrackKeys(new Set())
                setIsSelectingTracks(false)
            } else if (copyFetcher.data.error) {
                toast.error(copyFetcher.data.error)
            }
        }
        prevCopyState.current = copyFetcher.state
    }, [copyFetcher.state, copyFetcher.data])

    // Show toast for title update results
    const prevTitleState = useRef(titleFetcher.state)
    useEffect(() => {
        if (
            prevTitleState.current !== "idle" &&
            titleFetcher.state === "idle" &&
            titleFetcher.data
        ) {
            if (titleFetcher.data.titleUpdated) {
                toast.success("Card title updated")
            } else if (titleFetcher.data.error) {
                toast.error(titleFetcher.data.error)
            }
        }
        prevTitleState.current = titleFetcher.state
    }, [titleFetcher.state, titleFetcher.data])

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
        <div className="p-8">
            <div className="max-w-4xl mx-auto">
                <div className="mb-6">
                    <Link to="/cards" className="text-primary hover:underline">
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
                                if (coverPreview) {
                                    URL.revokeObjectURL(coverPreview)
                                }
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
                                        if (coverPreview) {
                                            URL.revokeObjectURL(coverPreview)
                                        }
                                        if (file) {
                                            setCoverPreview(
                                                URL.createObjectURL(file),
                                            )
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

                                        if (file.size > 10 * 1024 * 1024) {
                                            toast.error(
                                                "Cover image must be under 10MB",
                                            )
                                            return
                                        }

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
                        <h1 className="text-3xl font-bold">
                            <EditableTitle
                                value={card.title}
                                onSave={title => {
                                    titleFetcher.submit(
                                        {intent: "updateTitle", title},
                                        {method: "post"},
                                    )
                                }}
                                disabled={titleFetcher.state !== "idle"}
                                ariaLabel="Card title"
                            />
                        </h1>
                        <p className="text-muted-foreground">
                            {tracks.length} track
                            {tracks.length !== 1 ? "s" : ""}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                    <Button
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => setAddTracksDialogOpen(true)}
                    >
                        <Plus className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Add Tracks</span>
                    </Button>

                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                variant="outline"
                                disabled={
                                    isBusy ||
                                    isNumbering ||
                                    orderedTracks.length === 0
                                }
                            >
                                <ListOrdered className="h-4 w-4 sm:mr-2" />
                                <span className="hidden sm:inline">
                                    {isNumbering
                                        ? "Numbering..."
                                        : "Number Tracks"}
                                </span>
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>
                                    Number Tracks
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will set each track&apos;s icon to its
                                    position number (1, 2, 3...). Existing icons
                                    will be overwritten.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    disabled={isNumbering}
                                    onClick={() => {
                                        if (isNumbering) return
                                        numberFetcher.submit(
                                            {intent: "numberTracks"},
                                            {method: "post"},
                                        )
                                    }}
                                >
                                    Number Tracks
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>

                    <Button
                        variant="outline"
                        disabled={isBusy || orderedTracks.length === 0}
                        aria-label={
                            isSelectingTracks
                                ? "Cancel track selection"
                                : "Select tracks"
                        }
                        onClick={() => {
                            if (isSelectingTracks) {
                                setSelectedTrackKeys(new Set())
                            }

                            setIsSelectingTracks(!isSelectingTracks)
                        }}
                    >
                        {isSelectingTracks ? (
                            <X className="h-4 w-4 sm:mr-2" />
                        ) : (
                            <ListChecks className="h-4 w-4 sm:mr-2" />
                        )}
                        <span className="hidden sm:inline">
                            {isSelectingTracks ? "Cancel" : "Select Tracks"}
                        </span>
                    </Button>

                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                variant="destructive"
                                className="ml-auto"
                                disabled={isBusy}
                            >
                                <Trash2 className="h-4 w-4 sm:mr-2" />
                                <span className="hidden sm:inline">
                                    {isDeletingCard
                                        ? "Deleting..."
                                        : "Delete Card"}
                                </span>
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Delete Card</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Are you sure you want to delete &ldquo;
                                    {card.title}&rdquo;? This will permanently
                                    remove the card and all its tracks from your
                                    Yoto account. This action cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
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

                <Card>
                    <CardContent>
                        {isSelectingTracks && (
                            <div className="flex items-center gap-4 border-b py-3">
                                <Checkbox
                                    checked={
                                        allTracksSelected
                                            ? true
                                            : someTracksSelected
                                              ? "indeterminate"
                                              : false
                                    }
                                    disabled={isBusy}
                                    onCheckedChange={checked => {
                                        setSelectedTrackKeys(
                                            checked === true
                                                ? new Set(
                                                      orderedTracks.map(
                                                          track => track.key,
                                                      ),
                                                  )
                                                : new Set(),
                                        )
                                    }}
                                    aria-label={
                                        allTracksSelected
                                            ? "Deselect all tracks"
                                            : "Select all tracks"
                                    }
                                />
                                <span className="text-sm text-muted-foreground">
                                    {selectedTrackCount} of{" "}
                                    {orderedTracks.length} selected
                                </span>
                                <div className="ml-auto flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-muted-foreground hover:text-foreground"
                                        disabled={
                                            isBusy || selectedTrackCount === 0
                                        }
                                        aria-label={`Copy ${selectedTrackCount} selected track${
                                            selectedTrackCount === 1 ? "" : "s"
                                        }`}
                                        onClick={() => {
                                            setCopyTrackKeys(
                                                orderedTracks
                                                    .filter(track =>
                                                        selectedTrackKeys.has(
                                                            track.key,
                                                        ),
                                                    )
                                                    .map(track => track.key),
                                            )
                                        }}
                                    >
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-muted-foreground hover:text-destructive"
                                                disabled={
                                                    isBusy ||
                                                    selectedTrackCount === 0
                                                }
                                                aria-label={`Delete ${selectedTrackCount} selected track${
                                                    selectedTrackCount === 1
                                                        ? ""
                                                        : "s"
                                                }`}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>
                                                    Delete {selectedTrackCount}{" "}
                                                    Track
                                                    {selectedTrackCount === 1
                                                        ? ""
                                                        : "s"}
                                                </AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Are you sure you want to
                                                    delete {selectedTrackCount}{" "}
                                                    selected track
                                                    {selectedTrackCount === 1
                                                        ? ""
                                                        : "s"}
                                                    ? This will remove{" "}
                                                    {selectedTrackCount === 1
                                                        ? "it"
                                                        : "them"}{" "}
                                                    from the card.
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
                                                        value="deleteTracks"
                                                    />
                                                    <input
                                                        type="hidden"
                                                        name="trackKeys"
                                                        value={JSON.stringify([
                                                            ...selectedTrackKeys,
                                                        ])}
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
                        )}

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
                                {orderedTracks.map(track => (
                                    <TrackItem
                                        key={track.key}
                                        track={track}
                                        onDragEnd={handleDragEnd}
                                        isBusy={isBusy}
                                        isReordering={isReordering}
                                        isIconDialogOpen={
                                            selectedTrackKey === track.key
                                        }
                                        onIconDialogChange={(open: boolean) => {
                                            if (
                                                !open &&
                                                iconFetcher.state !== "idle"
                                            )
                                                return
                                            if (open) {
                                                setSelectedTrackKey(track.key)
                                            } else {
                                                setSelectedTrackKey(null)
                                            }
                                        }}
                                        iconPickerContent={
                                            <IconPickerContent
                                                onSelect={handleIconSelect}
                                            />
                                        }
                                        onCopy={() =>
                                            setCopyTrackKeys([track.key])
                                        }
                                        isSelecting={isSelectingTracks}
                                        isSelected={selectedTrackKeys.has(
                                            track.key,
                                        )}
                                        onSelectedChange={selected => {
                                            setSelectedTrackKeys(current => {
                                                const next = new Set(current)

                                                if (selected) {
                                                    next.add(track.key)
                                                } else {
                                                    next.delete(track.key)
                                                }

                                                return next
                                            })
                                        }}
                                    />
                                ))}
                            </Reorder.Group>
                        )}
                    </CardContent>
                </Card>

                <AddTracksDialog
                    cardId={card.id}
                    isBusy={isBusy}
                    open={addTracksDialogOpen}
                    onOpenChange={setAddTracksDialogOpen}
                />

                {copyTrackKeys.length > 0 && (
                    <CopyTrackDialog
                        tracks={copyTrackKeys.map(
                            trackKey =>
                                orderedTracks.find(
                                    track => track.key === trackKey,
                                ) ?? {
                                    key: trackKey,
                                    title: "Unknown Track",
                                },
                        )}
                        cards={otherCards}
                        open={true}
                        onOpenChange={open => {
                            if (!open) setCopyTrackKeys([])
                        }}
                        copyFetcher={copyFetcher}
                    />
                )}
            </div>
        </div>
    )
}
