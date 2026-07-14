import {beforeEach, describe, expect, it, vi} from "vitest"

// Mock the auth module
const mockLogout = vi.fn()

vi.mock("~/lib/auth.server", () => ({
    logout: (...args: unknown[]) => mockLogout(...args),
}))

// Mock the cloudflare context module
vi.mock("~/lib/cloudflare-context", () => ({
    cloudflareContext: Symbol("cloudflareContext"),
}))

// Import after mocks are set up
import {createMockEnv} from "~/tests/mocks"

import {action, loader} from "./logout"

// Mock env object
const mockEnv = createMockEnv()

beforeEach(() => {
    vi.clearAllMocks()
})

describe("logout action", () => {
    it("should call logout and redirect to / with Set-Cookie header", async () => {
        const clearCookie = "yoto-auth=; Max-Age=0; Path=/; HttpOnly"
        mockLogout.mockResolvedValue(clearCookie)

        const mockContext = {
            get: vi.fn().mockReturnValue({env: mockEnv}),
        }

        // Cast to unknown first to avoid complex React Router type requirements
        const request = new Request("http://localhost/logout", {
            method: "POST",
        })
        const response = await action({
            request,
            params: {},
            context: mockContext,
        } as unknown as Parameters<typeof action>[0])

        expect(mockLogout).toHaveBeenCalledWith(request, mockEnv)
        expect(response).toBeInstanceOf(Response)
        expect(response.status).toBe(302)
        expect(response.headers.get("Location")).toBe("/")
        expect(response.headers.get("Set-Cookie")).toBe(clearCookie)
    })
})

describe("logout loader", () => {
    it("should redirect GET requests to /", async () => {
        const response = await loader()

        expect(response).toBeInstanceOf(Response)
        expect(response.status).toBe(302)
        expect(response.headers.get("Location")).toBe("/")
    })
})
