import {useState} from "react"
import {Link, useFetcher, useSearchParams} from "react-router"

import {getAuthenticatedSdk, requireAuth} from "~/lib/auth.server"
import {performSync} from "~/lib/sync.server"

import {Button} from "~/components/ui/button"
import {Card, CardContent, CardHeader, CardTitle} from "~/components/ui/card"
import {Input} from "~/components/ui/input"
import {Label} from "~/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select"

export function meta() {
    return [
        {title: "Sync - Yoto Sync"},
        {name: "description", content: "Sync YouTube content to Yoto"},
    ]
}

export async function loader({request}: {request: Request}) {
    await requireAuth()

    const sdk = await getAuthenticatedSdk()
    const cards = await sdk.content.getMyCards()

    // Get cardId from URL if redirected from card detail
    const url = new URL(request.url)
    const preselectedCardId = url.searchParams.get("cardId")

    return {
        cards: cards.map(card => ({
            id: card.cardId,
            title: card.title ?? "Untitled Card",
        })),
        preselectedCardId,
    }
}

export async function action({request}: {request: Request}) {
    await requireAuth()

    const formData = await request.formData()
    const youtubeUrl = formData.get("youtubeUrl") as string
    const cardId = formData.get("cardId") as string
    const newCardName = formData.get("newCardName") as string

    if (!youtubeUrl) {
        return {error: "YouTube URL is required"}
    }

    if (!cardId && !newCardName) {
        return {error: "Please select a card or enter a name for a new card"}
    }

    const result = await performSync(
        youtubeUrl,
        cardId || null,
        newCardName || null,
    )
    return result
}

type ActionData = {
    error?: string
    success?: boolean
    message?: string
    cardId?: string
    added?: number
    skipped?: number
}

export default function Sync({
    loaderData,
}: {
    loaderData: Awaited<ReturnType<typeof loader>>
}) {
    const {cards, preselectedCardId} = loaderData
    const fetcher = useFetcher<ActionData>()
    const [searchParams] = useSearchParams()

    const [selectedCard, setSelectedCard] = useState(
        preselectedCardId ?? searchParams.get("cardId") ?? "",
    )
    const [showNewCardInput, setShowNewCardInput] = useState(false)

    const data = fetcher.data
    const isSubmitting = fetcher.state !== "idle"

    const handleCardChange = (value: string) => {
        setSelectedCard(value)
        setShowNewCardInput(value === "new")
    }

    return (
        <div className="min-h-screen p-8">
            <div className="max-w-2xl mx-auto">
                <div className="mb-6">
                    <Link to="/" className="text-primary hover:underline">
                        &larr; Back to Cards
                    </Link>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Sync YouTube Content</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {data?.success ? (
                            <div className="space-y-4">
                                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                                    <p className="text-green-700 dark:text-green-300 font-medium">
                                        {data.message}
                                    </p>
                                </div>
                                <div className="flex gap-4">
                                    <Link to={`/cards/${data.cardId}`}>
                                        <Button>View Card</Button>
                                    </Link>
                                    <Button
                                        variant="outline"
                                        onClick={() => window.location.reload()}
                                    >
                                        Sync More
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <fetcher.Form method="post" className="space-y-6">
                                <div className="space-y-2">
                                    <Label htmlFor="youtubeUrl">
                                        YouTube URL
                                    </Label>
                                    <Input
                                        id="youtubeUrl"
                                        name="youtubeUrl"
                                        type="url"
                                        placeholder="https://www.youtube.com/playlist?list=..."
                                        required
                                        disabled={isSubmitting}
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        Enter a YouTube playlist or video URL
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="cardId">
                                        Destination Card
                                    </Label>
                                    <Select
                                        name="cardId"
                                        value={selectedCard}
                                        onValueChange={handleCardChange}
                                        disabled={isSubmitting}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a card or create new" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="new">
                                                + Create New Card
                                            </SelectItem>
                                            {cards.map(card => (
                                                <SelectItem
                                                    key={card.id}
                                                    value={card.id}
                                                >
                                                    {card.title}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {showNewCardInput && (
                                    <div className="space-y-2">
                                        <Label htmlFor="newCardName">
                                            New Card Name
                                        </Label>
                                        <Input
                                            id="newCardName"
                                            name="newCardName"
                                            placeholder="Enter card name (or leave empty to use playlist name)"
                                            disabled={isSubmitting}
                                        />
                                    </div>
                                )}

                                {data?.error && (
                                    <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                                        <p className="text-red-700 dark:text-red-300">
                                            {data.error}
                                        </p>
                                    </div>
                                )}

                                <Button
                                    type="submit"
                                    className="w-full"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting
                                        ? "Syncing... (this may take a while)"
                                        : "Start Sync"}
                                </Button>

                                {isSubmitting && (
                                    <p className="text-sm text-muted-foreground text-center">
                                        Downloading from YouTube and uploading
                                        to Yoto. This can take several minutes
                                        for large playlists.
                                    </p>
                                )}
                            </fetcher.Form>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
