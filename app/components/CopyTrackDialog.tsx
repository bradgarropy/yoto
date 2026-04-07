import type {useFetcher} from "react-router"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog"
import type {TransferCard} from "~/lib/types"

const CopyTrackDialog = ({
    track,
    cards,
    open,
    onOpenChange,
    copyFetcher,
}: {
    track: {key: string; title: string}
    cards: TransferCard[]
    open: boolean
    onOpenChange: (open: boolean) => void
    copyFetcher: ReturnType<typeof useFetcher>
}) => {
    const isCopying = copyFetcher.state !== "idle"

    return (
        <Dialog
            open={open}
            onOpenChange={open => {
                if (!open && isCopying) return
                onOpenChange(open)
            }}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Copy Track</DialogTitle>

                    <DialogDescription>
                        Copy &ldquo;{track.title}&rdquo; to another card.
                    </DialogDescription>
                </DialogHeader>

                {cards.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                        No other cards available.
                    </p>
                ) : (
                    <div className="max-h-64 overflow-y-auto -mx-2">
                        {cards.map(card => {
                            const isThisCopying =
                                isCopying &&
                                copyFetcher.formData?.get(
                                    "destinationCardId",
                                ) === card.id

                            return (
                                <button
                                    key={card.id}
                                    type="button"
                                    className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-accent transition-colors text-left disabled:opacity-50"
                                    disabled={isCopying}
                                    onClick={() => {
                                        copyFetcher.submit(
                                            {
                                                intent: "copyTrack",
                                                trackKey: track.key,
                                                destinationCardId: card.id,
                                            },
                                            {method: "post"},
                                        )
                                    }}
                                >
                                    {card.coverUrl ? (
                                        <img
                                            src={card.coverUrl}
                                            alt=""
                                            className="w-10 h-10 rounded object-cover shrink-0"
                                        />
                                    ) : (
                                        <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                                            <span className="text-muted-foreground text-sm">
                                                ?
                                            </span>
                                        </div>
                                    )}

                                    <span className="font-medium truncate">
                                        {card.title}
                                    </span>

                                    {isThisCopying && (
                                        <span className="text-sm text-muted-foreground ml-auto shrink-0">
                                            Copying...
                                        </span>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

export {CopyTrackDialog}
