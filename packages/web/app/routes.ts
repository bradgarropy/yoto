import {type RouteConfig, index, route} from "@react-router/dev/routes"

export default [
    index("routes/home.tsx"),
    route("login", "routes/login.tsx"),
    route("cards/:id", "routes/cards.$id.tsx"),
    route("sync", "routes/sync.tsx"),
] satisfies RouteConfig
