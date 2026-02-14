import {Outlet} from "react-router"

import {authMiddleware} from "~/middleware/auth.server"

import type {Route} from "./+types/layout.protected"

export const middleware: Route.MiddlewareFunction[] = [authMiddleware]

export default function ProtectedLayout() {
    return <Outlet />
}
