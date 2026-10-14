import {completeLogin} from "~/lib/auth.server"

import type {Route} from "./+types/auth.callback"

export async function loader({request}: Route.LoaderArgs) {
    return completeLogin(request)
}
