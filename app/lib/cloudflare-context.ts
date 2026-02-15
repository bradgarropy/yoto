import {createContext} from "react-router"

// Context for Cloudflare environment - used by loaders/actions via context.get(cloudflareContext)
export type CloudflareContext = {
    env: Env
    ctx: ExecutionContext
}

export const cloudflareContext = createContext<CloudflareContext>()
