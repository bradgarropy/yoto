import {redirect} from "react-router"

import {logout} from "~/lib/auth.server"
import {cloudflareContext} from "~/lib/cloudflare-context"

import type {Route} from "./+types/logout"

export async function action({request, context}: Route.ActionArgs) {
    const {env} = context.get(cloudflareContext)
    const setCookie = await logout(request, env)

    return redirect("/", {
        headers: {"Set-Cookie": setCookie},
    })
}

// Redirect GET requests to landing page
export async function loader() {
    return redirect("/")
}
