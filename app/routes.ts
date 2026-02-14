import {index, layout, route, type RouteConfig} from "@react-router/dev/routes"

export default [
    // Public routes
    route("login", "routes/login.tsx"),

    // Protected routes (wrapped by auth middleware)
    layout("routes/layout.protected.tsx", [
        index("routes/home.tsx"),
        route("cards/:id", "routes/cards.$id.tsx"),
    ]),

    // API routes (keep existing auth pattern for now)
    route("api/import/:cardId", "routes/api.import.$cardId.tsx"),
    route("api/icons", "routes/api.icons.ts"),
] satisfies RouteConfig
