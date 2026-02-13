import {SearchIcon} from "lucide-react"
import {useEffect, useState} from "react"
import {useFetcher} from "react-router"

import {Button} from "~/components/ui/button"
import {
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog"
import {Input} from "~/components/ui/input"
import type {YotoIcon} from "~/lib/yoto-icons.server"
import type {CommunityIcon} from "~/lib/yotoicons-community.server"

type IconSelection =
    | ({type: "yoto"} & YotoIcon)
    | ({type: "community"} & CommunityIcon)

type IconPickerContentProps = {
    onSelect: (icon: IconSelection) => void
}

type IconsResponse = {
    yotoIcons: YotoIcon[]
    communityIcons: CommunityIcon[]
    communityError?: string
}

function IconPickerContent({onSelect}: IconPickerContentProps) {
    const [query, setQuery] = useState("")
    const [hasSearched, setHasSearched] = useState(false)
    const fetcher = useFetcher<IconsResponse>()

    const loading = fetcher.state !== "idle"
    const yotoIcons = fetcher.data?.yotoIcons ?? []
    const communityIcons = fetcher.data?.communityIcons ?? []
    const communityError = fetcher.data?.communityError
    const totalResults = yotoIcons.length + communityIcons.length

    // Track when a search has been performed
    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data) {
            setHasSearched(true)
        }
    }, [fetcher.state, fetcher.data])

    return (
        <>
            <DialogHeader>
                <DialogTitle>Choose Icon</DialogTitle>
                <DialogDescription>
                    Search for an icon from Yoto&apos;s official library or the
                    yotoicons.com community.
                </DialogDescription>
            </DialogHeader>

            <fetcher.Form
                method="get"
                action="/api/icons"
                className="flex gap-2"
            >
                <Input
                    name="q"
                    placeholder="Search icons..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    autoComplete="off"
                />
                <Button
                    type="submit"
                    disabled={loading || !query.trim()}
                    aria-label="Search"
                >
                    <SearchIcon />
                </Button>
            </fetcher.Form>

            <div className="min-h-50 max-h-[60vh] overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-50 text-muted-foreground">
                        Searching...
                    </div>
                ) : !hasSearched ? (
                    <div className="flex items-center justify-center h-50 text-muted-foreground text-center">
                        Search to find icons from Yoto&apos;s official library
                        and yotoicons.com.
                    </div>
                ) : totalResults === 0 ? (
                    <div className="flex items-center justify-center h-50 text-muted-foreground">
                        No results found
                    </div>
                ) : (
                    <div className="space-y-6">
                        {yotoIcons.length > 0 && (
                            <div>
                                <p className="text-sm text-muted-foreground mb-3">
                                    Yoto Icons ({yotoIcons.length} results)
                                </p>
                                <div className="grid grid-cols-8 gap-2">
                                    {yotoIcons.map((icon, index) => (
                                        <button
                                            key={`yoto-${icon.id}-${index}`}
                                            type="button"
                                            onClick={() =>
                                                onSelect({
                                                    type: "yoto",
                                                    ...icon,
                                                })
                                            }
                                            className="p-2 rounded-md bg-zinc-900 hover:bg-zinc-700 transition-colors w-fit"
                                            title={icon.title}
                                        >
                                            <img
                                                src={icon.url}
                                                alt={icon.title}
                                                className="w-8 h-8"
                                                style={{
                                                    imageRendering: "pixelated",
                                                }}
                                            />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {communityError && (
                            <p className="text-sm text-destructive">
                                Community icons unavailable: {communityError}
                            </p>
                        )}

                        {communityIcons.length > 0 && (
                            <div>
                                <p className="text-sm text-muted-foreground mb-3">
                                    Community Icons ({communityIcons.length}{" "}
                                    results)
                                </p>
                                <div className="grid grid-cols-8 gap-2">
                                    {communityIcons.map((icon, index) => (
                                        <button
                                            key={`community-${icon.id}-${index}`}
                                            type="button"
                                            onClick={() =>
                                                onSelect({
                                                    type: "community",
                                                    ...icon,
                                                })
                                            }
                                            className="p-2 rounded-md bg-zinc-900 hover:bg-zinc-700 transition-colors w-fit"
                                            title={icon.tags.join(", ")}
                                        >
                                            <img
                                                src={icon.url}
                                                alt={icon.tags.join(", ")}
                                                className="w-8 h-8"
                                                style={{
                                                    imageRendering: "pixelated",
                                                }}
                                            />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    )
}

export {IconPickerContent}
export type {IconSelection}
