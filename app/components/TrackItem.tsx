import {Copy, GripVertical, Trash2} from "lucide-react"
import {Reorder, useDragControls} from "motion/react"
import {Form} from "react-router"

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
import {Dialog, DialogContent, DialogTrigger} from "~/components/ui/dialog"
import {formatDuration} from "~/lib/format"

export type Track = {
    key: string
    title: string
    duration?: number
    iconUrl?: string
}

const TrackItem = ({
    track,
    onDragEnd,
    isBusy,
    isReordering,
    isIconDialogOpen,
    onIconDialogChange,
    iconPickerContent,
    onCopy,
}: {
    track: Track
    onDragEnd: () => void
    isBusy: boolean
    isReordering: boolean
    isIconDialogOpen: boolean
    onIconDialogChange: (open: boolean) => void
    iconPickerContent: React.ReactNode
    onCopy: () => void
}) => {
    const dragControls = useDragControls()

    return (
        <Reorder.Item
            key={track.key}
            value={track}
            className="py-3 flex items-center gap-4 bg-background"
            onDragEnd={onDragEnd}
            dragListener={false}
            dragControls={dragControls}
            initial={{
                scale: 1,
                boxShadow: "none",
            }}
            whileDrag={{
                scale: 1.02,
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                zIndex: 1,
            }}
            animate={{
                scale: 1,
                boxShadow: "none",
            }}
            transition={{
                duration: 0.2,
            }}
        >
            <button
                type="button"
                className="touch-none cursor-grab active:cursor-grabbing p-1 -m-1"
                onPointerDown={e => dragControls.start(e)}
                aria-label="Drag to reorder"
            >
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
            <Dialog open={isIconDialogOpen} onOpenChange={onIconDialogChange}>
                <DialogTrigger asChild>
                    <button
                        type="button"
                        className="shrink-0 p-2 rounded-md bg-zinc-900 hover:bg-zinc-700 transition-colors"
                        aria-label={`Change icon for ${track.title}`}
                    >
                        {track.iconUrl ? (
                            <img
                                src={track.iconUrl}
                                alt=""
                                className="w-8 h-8"
                                style={{
                                    imageRendering: "pixelated",
                                }}
                            />
                        ) : (
                            <div className="w-8 h-8 bg-zinc-700 rounded" />
                        )}
                    </button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                    {iconPickerContent}
                </DialogContent>
            </Dialog>
            <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{track.title}</p>
            </div>
            {track.duration && (
                <span className="text-sm text-muted-foreground">
                    {formatDuration(track.duration)}
                </span>
            )}
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    disabled={isBusy || isReordering}
                    aria-label={`Copy track: ${track.title}`}
                    onClick={onCopy}
                >
                    <Copy className="h-4 w-4" />
                </Button>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={isBusy || isReordering}
                            aria-label={`Delete track: ${track.title}`}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete Track</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete &ldquo;
                                {track.title}
                                &rdquo;? This will remove the track from the
                                card.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <Form method="post">
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
                            </Form>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </Reorder.Item>
    )
}

export {TrackItem}
