import "./app.css"

import {LogOut, User} from "lucide-react"
import {
    isRouteErrorResponse,
    Form,
    Link,
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    useLocation,
} from "react-router"

import {Avatar, AvatarFallback} from "~/components/ui/avatar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import {Toaster} from "~/components/ui/sonner"

export const links = () => [
    {rel: "icon", type: "image/png", href: "/favicon.png"},
    {rel: "preconnect", href: "https://fonts.googleapis.com"},
    {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
    },
    {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
    },
]

function Header() {
    const location = useLocation()
    const isLoginPage = location.pathname === "/login"
    const isLandingPage = location.pathname === "/"

    if (isLoginPage || isLandingPage) {
        return null
    }

    return (
        <header className="border-b bg-background px-8">
            <div className="max-w-6xl mx-auto h-14 flex items-center justify-between">
                <Link to="/cards" className="font-bold text-lg">
                    Yoto Sync
                </Link>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="rounded-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        >
                            <Avatar>
                                <AvatarFallback>
                                    <User className="h-4 w-4" />
                                </AvatarFallback>
                            </Avatar>
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <Form action="/logout" method="post">
                            <DropdownMenuItem asChild>
                                <button type="submit" className="w-full">
                                    <LogOut className="mr-2 h-4 w-4" />
                                    Logout
                                </button>
                            </DropdownMenuItem>
                        </Form>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    )
}

export function Layout({children}: {children: React.ReactNode}) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
                <Meta />
                <Links />
            </head>
            <body>
                <Toaster richColors />
                {children}
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    )
}

export default function App() {
    return (
        <>
            <Header />
            <Outlet />
        </>
    )
}

export function ErrorBoundary({error}: {error: unknown}) {
    let message = "Oops!"
    let details = "An unexpected error occurred."
    let stack: string | undefined

    if (isRouteErrorResponse(error)) {
        message = error.status === 404 ? "404" : "Error"
        details =
            error.status === 404
                ? "The requested page could not be found."
                : error.statusText || details
    } else if (import.meta.env.DEV && error && error instanceof Error) {
        details = error.message
        stack = error.stack
    }

    return (
        <main className="pt-16 p-4 container mx-auto">
            <h1>{message}</h1>
            <p>{details}</p>
            {stack && (
                <pre className="w-full p-4 overflow-x-auto">
                    <code>{stack}</code>
                </pre>
            )}
        </main>
    )
}
