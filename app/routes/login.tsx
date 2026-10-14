import {Form, redirect, useLoaderData, useNavigation} from "react-router"

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
        throw redirect("/cards", {
            headers: authStatus.setCookie
                ? {"Set-Cookie": authStatus.setCookie}
                : undefined,
        })
    }

    const errorCode = new URL(request.url).searchParams.get("error")
    const errors: Record<string, string> = {
        access_denied: "Yoto access was denied. Please try again.",
        expired_state: "Your login attempt expired. Please start again.",
        invalid_callback: "Yoto returned an incomplete login response.",
        provider_error: "Yoto could not complete the login request.",
        state_mismatch: "The login response could not be verified.",
        token_exchange_failed: "Yoto login failed while creating your session.",
    }

    return {
        error: errorCode ? (errors[errorCode] ?? errors.provider_error) : null,
    }
}

// Start the browser-based Authorization Code flow with PKCE.
export async function action({request}: Route.ActionArgs) {
    return initiateLogin(request)
}

export default function Login() {
    const {error} = useLoaderData<typeof loader>()
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
                <CardContent className="space-y-4">
                    {error && (
                        <p
                            role="alert"
                            className="text-center text-sm text-destructive"
                        >
                            {error}
                        </p>
                    )}
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
