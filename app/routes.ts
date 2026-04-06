import {index, layout, route, type RouteConfig} from "@react-router/dev/routes"

export default [
    // Public routes
    route("login", "routes/login.tsx"),
    route("logout", "routes/logout.tsx"),
    index("routes/landing.tsx"),

    // Protected routes (wrapped by auth middleware)
    layout("routes/layout.protected.tsx", [
        route("cards", "routes/cards.tsx"),
        route("cards/:id", "routes/cards.$id.tsx"),
    ]),

    // API routes (keep existing auth pattern for now)
    route("api/import/:cardId", "routes/api.import.$cardId.tsx"),
    route("api/icons", "routes/api.icons.ts"),
    route("api/feedback", "routes/api.feedback.tsx"),
] satisfies RouteConfig
