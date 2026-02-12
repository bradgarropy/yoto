import {isAuthenticated} from "~/lib/auth.server"
import {searchYotoIcons} from "~/lib/yoto-icons.server"

export async function loader({request}: {request: Request}) {
    const authenticated = await isAuthenticated()
    if (!authenticated) {
        return new Response("Unauthorized", {status: 401})
    }

    const url = new URL(request.url)
    const query = url.searchParams.get("q")

    if (!query) {
        return Response.json({yotoIcons: []})
    }

    const yotoIcons = await searchYotoIcons(query)

    return Response.json({yotoIcons})
}
