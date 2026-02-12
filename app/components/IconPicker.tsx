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

type IconPickerContentProps = {
    onSelect: (icon: YotoIcon) => void
}

type IconsResponse = {
    yotoIcons: YotoIcon[]
}

function IconPickerContent({onSelect}: IconPickerContentProps) {
    const [query, setQuery] = useState("")
    const [hasSearched, setHasSearched] = useState(false)
    const fetcher = useFetcher<IconsResponse>()

    const loading = fetcher.state === "loading"
    const icons = fetcher.data?.yotoIcons ?? []

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
                    Search for an icon from Yoto&apos;s official library.
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
                />
                <Button
                    type="submit"
                    disabled={loading || !query.trim()}
                    aria-label="Search"
                >
                    <SearchIcon />
                </Button>
            </fetcher.Form>

            <div className="min-h-50">
                {loading ? (
                    <div className="flex items-center justify-center h-50 text-muted-foreground">
                        Searching...
                    </div>
                ) : !hasSearched ? (
                    <div className="flex items-center justify-center h-50 text-muted-foreground text-center">
                        Search to find icons from Yoto&apos;s official library.
                    </div>
                ) : icons.length === 0 ? (
                    <div className="flex items-center justify-center h-50 text-muted-foreground">
                        No results found
                    </div>
                ) : (
                    <div>
                        <p className="text-sm text-muted-foreground mb-3">
                            Yoto Icons ({icons.length} results)
                        </p>
                        <div className="grid grid-cols-8 gap-2">
                            {icons.map((icon, index) => (
                                <button
                                    key={`${icon.id}-${index}`}
                                    type="button"
                                    onClick={() => onSelect(icon)}
                                    className="p-2 rounded-md bg-zinc-900 hover:bg-zinc-700 transition-colors w-fit"
                                    title={icon.title}
                                >
                                    <img
                                        src={icon.url}
                                        alt={icon.title}
                                        className="w-8 h-8"
                                        style={{imageRendering: "pixelated"}}
                                    />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </>
    )
}

export {IconPickerContent}
