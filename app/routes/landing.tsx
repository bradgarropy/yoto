import {ListMusic, Sparkles, Wallet} from "lucide-react"
import {Link, redirect} from "react-router"

import {Button} from "~/components/ui/button"
import {Card, CardContent, CardHeader, CardTitle} from "~/components/ui/card"
import {status} from "~/lib/auth.server"
import {cloudflareContext} from "~/lib/cloudflare-context"

import type {Route} from "./+types/landing"

export function meta() {
    return [
        {title: "Yoto Sync"},
        {
            name: "description",
            content: "Sync YouTube playlists to your Yoto cards",
        },
    ]
}

// Redirect to cards dashboard if already logged in
export async function loader({request, context}: Route.LoaderArgs) {
    const {env} = context.get(cloudflareContext)
    const authStatus = await status(request, env)

    if (authStatus.valid) {
        throw redirect("/cards")
    }

    return {}
}

export default function Landing() {
    return (
        <div className="min-h-screen">
            {/* Hero Section */}
            <section className="flex flex-col items-center justify-center px-4 py-24 text-center">
                <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
                    Yoto Sync
                </h1>
                <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
                    Sync YouTube playlists to your Yoto cards.
                    <br />
                    Easily manage and organize audio content for your kids.
                </p>
                <div className="mt-10">
                    <Button asChild size="lg">
                        <Link to="/login">Get Started</Link>
                    </Button>
                </div>
            </section>

            {/* Features Section */}
            <section className="px-4 py-16">
                <div className="mx-auto max-w-6xl">
                    <h2 className="mb-12 text-center text-3xl font-bold">
                        Features
                    </h2>
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <ListMusic className="h-5 w-5" />
                                    Sync YouTube Playlists
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-muted-foreground">
                                    Import audio from YouTube playlists directly
                                    to your Yoto cards with just a few clicks.
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Wallet className="h-5 w-5" />
                                    Manage Your Cards
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-muted-foreground">
                                    Create, edit, and organize your Yoto cards.
                                    Add tracks, reorder content, and customize
                                    covers.
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Sparkles className="h-5 w-5" />
                                    Easy to Use
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-muted-foreground">
                                    Simple interface designed for parents. No
                                    technical knowledge required.
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </section>
        </div>
    )
}
