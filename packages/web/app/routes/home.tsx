import {Link} from "react-router"

import {getAuthenticatedSdk, status} from "~/lib/auth.server"

import {Button} from "~/components/ui/button"
import {Card, CardContent, CardHeader, CardTitle} from "~/components/ui/card"

export function meta() {
    return [
        {title: "Yoto Sync"},
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

export default function Home({
    loaderData,
}: {
    loaderData: Awaited<ReturnType<typeof loader>>
}) {
    const {authenticated, cards} = loaderData

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
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold">My Yoto Cards</h1>
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
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {cards.map(card => (
                            <Link key={card.id} to={`/cards/${card.id}`}>
                                <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer h-full py-0 rounded-2xl">
                                    {card.coverUrl ? (
                                        <div className="aspect-square bg-muted">
                                            <img
                                                src={card.coverUrl}
                                                alt={card.title}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    ) : (
                                        <div className="aspect-square bg-muted flex items-center justify-center">
                                            <span className="text-4xl text-muted-foreground">
                                                ?
                                            </span>
                                        </div>
                                    )}
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
