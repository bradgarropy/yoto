import {useEffect, useState} from "react"
import {redirect, useFetcher} from "react-router"

import {Button} from "~/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "~/components/ui/card"
import {completeLogin, initiateLogin, status} from "~/lib/auth.server"
import {cloudflareContext} from "~/lib/cloudflare-context"

import type {Route} from "./+types/login"

type ActionData =
    | {step: "idle"}
    | {
          step: "pending"
          verificationUri: string
          userCode: string
          deviceCode: string
          interval: number
      }
    | {step: "error"; error: string}

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

// Handle the two-step device code flow
export async function action({
    request,
    context,
}: Route.ActionArgs): Promise<ActionData | Response> {
    const {env} = context.get(cloudflareContext)

    const formData = await request.formData()
    const intent = formData.get("intent")

    if (intent === "initiate") {
        // Step 1: Start device code flow
        const deviceCode = await initiateLogin()

        return {
            step: "pending" as const,
            verificationUri:
                deviceCode.verificationUriComplete ??
                deviceCode.verificationUri ??
                "",
            userCode: deviceCode.userCode ?? "",
            deviceCode: deviceCode.deviceCode ?? "",
            interval: deviceCode.interval ?? 5,
        }
    }

    if (intent === "complete") {
        // Step 2: Poll for token
        const deviceCode = formData.get("deviceCode") as string
        const interval = parseInt(formData.get("interval") as string, 10)

        const result = await completeLogin(env, deviceCode, interval)

        if (result.success) {
            return redirect("/cards", {
                headers: {"Set-Cookie": result.setCookie},
            })
        }

        return {
            step: "error" as const,
            error: result.error,
        }
    }

    return {step: "idle" as const}
}

export default function Login() {
    const fetcher = useFetcher<typeof action>()
    const [polling, setPolling] = useState(false)

    const data = fetcher.data
    const isLoading = fetcher.state !== "idle"

    // When we get device code, start polling automatically
    useEffect(() => {
        if (data?.step === "pending" && !polling) {
            setPolling(true)

            // Submit the complete action
            const formData = new FormData()
            formData.set("intent", "complete")
            formData.set("deviceCode", data.deviceCode)
            formData.set("interval", data.interval.toString())

            fetcher.submit(formData, {method: "post"})
        }
    }, [data, polling, fetcher])

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>Login to Yoto</CardTitle>
                    <CardDescription>
                        Authenticate with your Yoto account using device code
                        flow
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {!data || data.step === "idle" ? (
                        <fetcher.Form method="post">
                            <input
                                type="hidden"
                                name="intent"
                                value="initiate"
                            />
                            <Button
                                type="submit"
                                className="w-full"
                                disabled={isLoading}
                            >
                                {isLoading ? "Starting..." : "Start Login"}
                            </Button>
                        </fetcher.Form>
                    ) : data.step === "pending" ? (
                        <div className="space-y-4">
                            <div className="text-center">
                                <p className="text-sm text-muted-foreground mb-2">
                                    Go to:
                                </p>
                                <a
                                    href={data.verificationUri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary underline font-mono text-sm break-all"
                                >
                                    {data.verificationUri}
                                </a>
                            </div>

                            <div className="text-center">
                                <p className="text-sm text-muted-foreground mb-2">
                                    Or enter this code:
                                </p>
                                <p className="text-3xl font-mono font-bold tracking-wider">
                                    {data.userCode}
                                </p>
                            </div>

                            <div className="text-center text-sm text-muted-foreground">
                                {polling ? (
                                    <p className="animate-pulse">
                                        Waiting for authentication...
                                    </p>
                                ) : (
                                    <p>Click the link above to authenticate</p>
                                )}
                            </div>
                        </div>
                    ) : data.step === "error" ? (
                        <div className="space-y-4">
                            <p className="text-destructive text-center">
                                {data.error}
                            </p>
                            <fetcher.Form method="post">
                                <input
                                    type="hidden"
                                    name="intent"
                                    value="initiate"
                                />
                                <Button type="submit" className="w-full">
                                    Try Again
                                </Button>
                            </fetcher.Form>
                        </div>
                    ) : null}
                </CardContent>
            </Card>
        </div>
    )
}
