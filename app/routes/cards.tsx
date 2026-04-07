import {ArrowDownNarrowWide, Plus} from "lucide-react"
import {useEffect, useState} from "react"
import {Link, useFetcher, useNavigate} from "react-router"
import {toast} from "sonner"

import {CardCover} from "~/components/CardCover"
import {Button} from "~/components/ui/button"
import {Card, CardContent} from "~/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "~/components/ui/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import {Input} from "~/components/ui/input"
import {Label} from "~/components/ui/label"
import {DEFAULT_CARD_COVER_URL} from "~/lib/constants"
import {getCardCoverUrl} from "~/lib/types"
import {authContext} from "~/middleware/auth.server"

import type {Route} from "./+types/cards"

type SortOption = "title" | "tracks" | "updated"

type CardSummary = {
    id: string
    title: string
    coverUrl: string | undefined
    trackCount: number
    updatedAt: string | null
}

type LoaderData = {
    cards: CardSummary[]
}

type YotoContent = {
    activity: string
    chapters: never[]
    restricted: boolean
    config: {onlineOnly: boolean}
    version: string
}

type YotoMetadata = {
    cover?: {imageL: string}
    media?: Record<string, unknown>
}

type YotoCard = {
    cardId?: string
    title?: string
    content: YotoContent
    metadata: YotoMetadata
}

export function meta() {
    return [
        {title: "My Cards - Yoto Sync"},
        {name: "description", content: "Manage your Yoto cards"},
    ]
}

export async function loader({context}: Route.LoaderArgs) {
    const {sdk} = context.get(authContext)

    try {
        const cards = await sdk.content.getMyCards()

        // Fetch full card details in parallel to get track counts
        const cardsWithDetails = await Promise.all(
            cards.map(async card => {
                try {
                    const fullCard = (await sdk.content.getCard(
                        card.cardId,
                    )) as {
                        content?: {chapters?: Array<unknown>}
                    }
                    return {
                        id: card.cardId,
                        title: card.title ?? "Untitled Card",
                        coverUrl: getCardCoverUrl(card),
                        trackCount: fullCard.content?.chapters?.length ?? 0,
                        updatedAt: card.updatedAt ?? null,
                    }
                } catch {
                    // Fallback if we can't fetch full card
                    return {
                        id: card.cardId,
                        title: card.title ?? "Untitled Card",
                        coverUrl: getCardCoverUrl(card),
                        trackCount: 0,
                        updatedAt: card.updatedAt ?? null,
                    }
                }
            }),
        )

        return {cards: cardsWithDetails}
    } catch (error) {
        console.error("Failed to fetch cards:", error)
        return {cards: []}
    }
}

export async function action({request, context}: Route.ActionArgs) {
    const formData = await request.formData()
    const intent = formData.get("intent") as string

    if (intent === "createCard") {
        const cardName = formData.get("cardName") as string

        if (!cardName?.trim()) {
            return {error: "Card name is required"}
        }

        try {
            const {sdk} = context.get(authContext)
            const cardData = {
                title: cardName.trim(),
                content: {
                    activity: "yoto_Player",
                    chapters: [],
                    restricted: true,
                    config: {onlineOnly: false},
                    version: "1",
                },
                metadata: {
                    cover: {
                        imageL: DEFAULT_CARD_COVER_URL,
                    },
                    media: {},
                },
            }

            const result = (await sdk.content.updateCard(
                cardData as unknown as Parameters<
                    typeof sdk.content.updateCard
                >[0],
            )) as YotoCard

            return {success: true, cardId: result.cardId}
        } catch (error) {
            console.error("Failed to create card:", error)
            return {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to create card",
            }
        }
    }

    return {error: "Unknown action"}
}

const sortCards = (cards: CardSummary[], sortBy: SortOption) => {
    return [...cards].sort((a, b) => {
        switch (sortBy) {
            case "title":
                return a.title.localeCompare(b.title)
            case "tracks":
                return b.trackCount - a.trackCount
            case "updated":
                // Cards with updatedAt come first, sorted by most recent
                if (a.updatedAt && b.updatedAt) {
                    return (
                        new Date(b.updatedAt).getTime() -
                        new Date(a.updatedAt).getTime()
                    )
                }
                if (a.updatedAt) return -1
                if (b.updatedAt) return 1
                return 0
            default:
                return 0
        }
    })
}

type ActionData = {
    success?: boolean
    cardId?: string
    error?: string
}

export default function Cards({loaderData}: {loaderData: LoaderData}) {
    const {cards} = loaderData
    const [sortBy, setSortBy] = useState<SortOption>("title")
    const [searchQuery, setSearchQuery] = useState("")
    const [dialogOpen, setDialogOpen] = useState(false)
    const [cardName, setCardName] = useState("")
    const fetcher = useFetcher<ActionData>()
    const navigate = useNavigate()

    const isCreating = fetcher.state !== "idle"

    // Navigate to the new card on success or show error
    useEffect(() => {
        if (fetcher.data?.success && fetcher.data?.cardId) {
            setDialogOpen(false)
            setCardName("")
            navigate(`/cards/${fetcher.data.cardId}`)
        } else if (fetcher.data?.error) {
            toast.error(fetcher.data.error)
        }
    }, [fetcher.data, navigate])

    const filteredCards = cards.filter(card =>
        card.title.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    const sortedCards = sortCards(filteredCards, sortBy)

    return (
        <div className="p-8 pb-32">
            <div className="max-w-6xl mx-auto">
                <h1 className="text-3xl font-bold mb-6">My Cards</h1>
                <div className="flex items-center gap-3 mb-8">
                    <Input
                        type="text"
                        placeholder="Search cards..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="flex-1"
                    />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="icon"
                                aria-label="Sort cards"
                            >
                                <ArrowDownNarrowWide className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => setSortBy("title")}
                            >
                                Title
                                {sortBy === "title" && (
                                    <span className="ml-auto">✓</span>
                                )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => setSortBy("tracks")}
                            >
                                Track Count
                                {sortBy === "tracks" && (
                                    <span className="ml-auto">✓</span>
                                )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => setSortBy("updated")}
                            >
                                Last Updated
                                {sortBy === "updated" && (
                                    <span className="ml-auto">✓</span>
                                )}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="h-4 w-4" />
                                Create Card
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Create New Card</DialogTitle>
                                <DialogDescription>
                                    Create a new Yoto card to add tracks to.
                                </DialogDescription>
                            </DialogHeader>
                            <fetcher.Form method="post">
                                <input
                                    type="hidden"
                                    name="intent"
                                    value="createCard"
                                />
                                <div className="grid gap-4 py-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="cardName">
                                            Card Name
                                        </Label>
                                        <Input
                                            id="cardName"
                                            name="cardName"
                                            placeholder="Enter card name..."
                                            value={cardName}
                                            onChange={e =>
                                                setCardName(e.target.value)
                                            }
                                            disabled={isCreating}
                                            autoComplete="off"
                                        />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setDialogOpen(false)}
                                        disabled={isCreating}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={
                                            isCreating || !cardName.trim()
                                        }
                                    >
                                        {isCreating
                                            ? "Creating..."
                                            : "Create Card"}
                                    </Button>
                                </DialogFooter>
                            </fetcher.Form>
                        </DialogContent>
                    </Dialog>
                </div>

                {cards.length === 0 ? (
                    <Card>
                        <CardContent className="py-8 text-center">
                            <p className="text-muted-foreground mb-4">
                                No cards found. Create a card to get started.
                            </p>
                            <Button onClick={() => setDialogOpen(true)}>
                                <Plus className="h-4 w-4" />
                                Create Your First Card
                            </Button>
                        </CardContent>
                    </Card>
                ) : sortedCards.length === 0 ? (
                    <Card>
                        <CardContent className="py-8 text-center">
                            <p className="text-muted-foreground">
                                No cards match &ldquo;{searchQuery}&rdquo;
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {sortedCards.map(card => (
                            <Link key={card.id} to={`/cards/${card.id}`}>
                                <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer h-full py-0 gap-0 rounded-2xl">
                                    <CardCover
                                        coverUrl={card.coverUrl}
                                        title={card.title}
                                    />
                                    <CardContent className="p-4">
                                        <h3 className="font-semibold truncate">
                                            {card.title}
                                        </h3>
                                        <p className="text-sm text-muted-foreground">
                                            {card.trackCount} track
                                            {card.trackCount !== 1 ? "s" : ""}
                                        </p>
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
