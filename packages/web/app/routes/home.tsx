import {ArrowDownNarrowWide} from "lucide-react"
import {useState} from "react"
import {Link} from "react-router"

import {CardCover} from "~/components/CardCover"
import {Button} from "~/components/ui/button"
import {Card, CardContent, CardHeader, CardTitle} from "~/components/ui/card"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import {Input} from "~/components/ui/input"
import {getAuthenticatedSdk, status} from "~/lib/auth.server"
import {readTracks} from "~/lib/tracks.server"

type SortOption = "title" | "tracks" | "updated"

export function meta() {
    return [
        {title: "Yoto"},
        {name: "description", content: "Sync YouTube playlists to Yoto"},
    ]
}

export async function loader() {
    const authStatus = await status()

    if (!authStatus.valid) {
        // Return unauthenticated state - don't redirect, show login prompt
        return {authenticated: false as const, cards: []}
    }

    try {
        const sdk = await getAuthenticatedSdk()
        const cards = await sdk.content.getMyCards()
        const tracksData = readTracks()

        // SDK returns array of UserCard directly
        // The actual API response includes metadata.cover, not cover directly
        type CardWithMetadata = (typeof cards)[0] & {
            metadata?: {
                cover?: {imageL?: string; imageM?: string; imageS?: string}
            }
        }

        // Fetch full card details in parallel to get track counts
        const cardsWithDetails = await Promise.all(
            cards.map(async card => {
                const cardWithMeta = card as CardWithMetadata
                const cardTracks = tracksData[card.cardId]
                try {
                    const fullCard = (await sdk.content.getCard(
                        card.cardId,
                    )) as {
                        content?: {chapters?: Array<unknown>}
                    }
                    return {
                        id: card.cardId,
                        title: card.title ?? "Untitled Card",
                        coverUrl:
                            cardWithMeta.metadata?.cover?.imageL ??
                            cardWithMeta.metadata?.cover?.imageM ??
                            cardWithMeta.metadata?.cover?.imageS ??
                            card.cover?.imageL ??
                            card.cover?.imageM ??
                            card.cover?.imageS,
                        trackCount: fullCard.content?.chapters?.length ?? 0,
                        lastSynced: cardTracks?.lastSynced ?? null,
                    }
                } catch {
                    // Fallback if we can't fetch full card
                    return {
                        id: card.cardId,
                        title: card.title ?? "Untitled Card",
                        coverUrl:
                            cardWithMeta.metadata?.cover?.imageL ??
                            cardWithMeta.metadata?.cover?.imageM ??
                            cardWithMeta.metadata?.cover?.imageS ??
                            card.cover?.imageL ??
                            card.cover?.imageM ??
                            card.cover?.imageS,
                        trackCount: 0,
                        lastSynced: cardTracks?.lastSynced ?? null,
                    }
                }
            }),
        )

        return {
            authenticated: true as const,
            cards: cardsWithDetails,
        }
    } catch (error) {
        console.error("Failed to fetch cards:", error)
        return {authenticated: true as const, cards: []}
    }
}

const sortCards = (
    cards: Awaited<ReturnType<typeof loader>>["cards"],
    sortBy: SortOption,
) => {
    return [...cards].sort((a, b) => {
        switch (sortBy) {
            case "title":
                return a.title.localeCompare(b.title)
            case "tracks":
                return b.trackCount - a.trackCount
            case "updated":
                // Cards with lastSynced come first, sorted by most recent
                if (a.lastSynced && b.lastSynced) {
                    return (
                        new Date(b.lastSynced).getTime() -
                        new Date(a.lastSynced).getTime()
                    )
                }
                if (a.lastSynced) return -1
                if (b.lastSynced) return 1
                return 0
            default:
                return 0
        }
    })
}

export default function Home({
    loaderData,
}: {
    loaderData: Awaited<ReturnType<typeof loader>>
}) {
    const {authenticated, cards} = loaderData
    const [sortBy, setSortBy] = useState<SortOption>("title")
    const [searchQuery, setSearchQuery] = useState("")

    const filteredCards = cards.filter(card =>
        card.title.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    const sortedCards = sortCards(filteredCards, sortBy)

    if (!authenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4">
                <Card className="w-full max-w-md">
                    <CardHeader>
                        <CardTitle>Welcome to Yoto Sync</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-muted-foreground">
                            Sync your favorite YouTube playlists to your Yoto
                            cards.
                        </p>
                        <Link to="/login">
                            <Button className="w-full">
                                Login to Get Started
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen p-8">
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
                            <Button variant="outline" size="icon">
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
                                Last Synced
                                {sortBy === "updated" && (
                                    <span className="ml-auto">✓</span>
                                )}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Link to="/sync">
                        <Button>Sync New Content</Button>
                    </Link>
                </div>

                {cards.length === 0 ? (
                    <Card>
                        <CardContent className="py-8 text-center">
                            <p className="text-muted-foreground mb-4">
                                No cards found. Create a card in the Yoto app
                                first, or sync new content.
                            </p>
                            <Link to="/sync">
                                <Button>Sync Your First Content</Button>
                            </Link>
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
