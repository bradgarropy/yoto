import {MessageSquare} from "lucide-react"
import {useState} from "react"
import {toast} from "sonner"

import {Button} from "~/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "~/components/ui/dialog"
import {Input} from "~/components/ui/input"
import {Label} from "~/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "~/components/ui/select"
import {Textarea} from "~/components/ui/textarea"

const FeedbackDialog = () => {
    const [open, setOpen] = useState(false)
    const [category, setCategory] = useState("")
    const [message, setMessage] = useState("")
    const [email, setEmail] = useState("")

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        if (!category || !message.trim()) {
            toast.error("Please select a category and enter a message.")
            return
        }

        // TODO: Replace with useFetcher POST to /api/feedback in Phase 3
        toast.success("Thanks for your feedback!")

        setCategory("")
        setMessage("")
        setEmail("")
        setOpen(false)
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    <MessageSquare className="h-4 w-4" />
                    Feedback
                </button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Send Feedback</DialogTitle>

                    <DialogDescription>
                        Report a bug, request a feature, or share your thoughts.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="grid gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="category">Category</Label>

                        <Select value={category} onValueChange={setCategory}>
                            <SelectTrigger id="category" className="w-full">
                                <SelectValue placeholder="Select a category" />
                            </SelectTrigger>

                            <SelectContent>
                                <SelectItem value="bug">Bug Report</SelectItem>

                                <SelectItem value="feature">
                                    Feature Request
                                </SelectItem>

                                <SelectItem value="feedback">
                                    General Feedback
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="message">Message</Label>

                        <Textarea
                            id="message"
                            placeholder="Tell us what's on your mind..."
                            rows={4}
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            required
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="email">
                            Email{" "}
                            <span className="text-muted-foreground font-normal">
                                (optional)
                            </span>
                        </Label>

                        <Input
                            id="email"
                            type="email"
                            placeholder="your@email.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                        />

                        <p className="text-xs text-muted-foreground">
                            Include your email if you&apos;d like a response.
                        </p>
                    </div>

                    <DialogFooter>
                        <Button type="submit">Send Feedback</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export {FeedbackDialog}
