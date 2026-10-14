import {Form, redirect, useNavigation} from "react-router"

import {Button} from "~/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "~/components/ui/card"
import {initiateLogin, status} from "~/lib/auth.server"
import {cloudflareContext} from "~/lib/cloudflare-context"

import type {Route} from "./+types/login"

export function meta() {
    return [
        {title: "Login - Yoto Sync"},
        {name: "description", content: "Login to Yoto Sync"},
    ]
}

// Redirect to dashboard if already logged in
export async function loader({request, context}: Route.LoaderArgs) {
    const {env} = context.get(cloudflareContext)

    const authStatus = await status(request, env)

    if (authStatus.valid) {
        throw redirect("/cards")
    }

    return {}
}

// Start the browser-based Authorization Code flow with PKCE.
export async function action({request}: Route.ActionArgs) {
    return initiateLogin(request)
}

export default function Login() {
    const navigation = useNavigation()
    const isStarting = navigation.state !== "idle"

    return (
        <div className="flex flex-1 items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Connect your Yoto account</CardTitle>
                    <CardDescription>
                        You’ll continue to Yoto’s secure sign-in page, then
                        return here automatically.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form method="post">
                        <Button
                            type="submit"
                            className="w-full"
                            disabled={isStarting}
                        >
                            {isStarting ? "Redirecting..." : "Continue to Yoto"}
                        </Button>
                    </Form>
                </CardContent>
            </Card>
        </div>
    )
}
