import type {FetcherWithComponents} from "react-router"

import {CARD_ASPECT_RATIO} from "~/components/CardCover"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog"
import type {TransferCard} from "~/lib/types"
import type {ActionData} from "~/routes/cards.$id"

const CopyTrackDialog = ({
    tracks,
    cards,
    open,
    onOpenChange,
    copyFetcher,
}: {
    tracks: Array<{key: string; title: string}>
    cards: TransferCard[]
    open: boolean
    onOpenChange: (open: boolean) => void
    copyFetcher: FetcherWithComponents<ActionData>
}) => {
    const isCopying = copyFetcher.state !== "idle"
    const isMultiple = tracks.length > 1

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
                    <DialogTitle>
                        Copy {isMultiple ? "Tracks" : "Track"}
                    </DialogTitle>

                    <DialogDescription>
                        {isMultiple ? (
                            `Copy ${tracks.length} selected tracks to another card.`
                        ) : (
                            <>
                                Copy &ldquo;
                                {tracks[0]?.title ?? "Unknown Track"}
                                &rdquo; to another card.
                            </>
                        )}
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
                                        const trackKeys = tracks.map(
                                            track => track.key,
                                        )

                                        copyFetcher.submit(
                                            isMultiple
                                                ? {
                                                      intent: "copyTracks",
                                                      trackKeys:
                                                          JSON.stringify(
                                                              trackKeys,
                                                          ),
                                                      destinationCardId:
                                                          card.id,
                                                  }
                                                : {
                                                      intent: "copyTrack",
                                                      trackKey: trackKeys[0],
                                                      destinationCardId:
                                                          card.id,
                                                  },
                                            {method: "post"},
                                        )
                                    }}
                                >
                                    {card.coverUrl ? (
                                        <img
                                            src={card.coverUrl}
                                            alt=""
                                            className={`w-8 ${CARD_ASPECT_RATIO} rounded object-cover shrink-0`}
                                        />
                                    ) : (
                                        <div
                                            className={`w-8 ${CARD_ASPECT_RATIO} rounded bg-muted flex items-center justify-center shrink-0`}
                                        >
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
