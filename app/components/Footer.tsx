import {Github} from "lucide-react"

import {FeedbackDialog} from "~/components/FeedbackDialog"

const Footer = () => {
    return (
        <footer className="border-t bg-background px-8 py-8">
            <div className="max-w-6xl mx-auto flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <p className="font-bold text-lg">Yoto Sync</p>
                    <p className="text-sm text-muted-foreground mt-1">
                        Sync YouTube content to Yoto cards.
                    </p>
                </div>

                <div className="flex flex-col items-start gap-2 sm:items-end">
                    <div className="flex items-center gap-4">
                        <FeedbackDialog />
                        <a
                            href="https://github.com/bradgarropy/yoto"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <Github className="h-4 w-4" />
                            GitHub
                        </a>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Made by{" "}
                        <a
                            href="https://bradgarropy.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-foreground transition-colors underline underline-offset-4"
                        >
                            Brad Garropy
                        </a>
                    </p>
                </div>
            </div>
        </footer>
    )
}

export {Footer}
