import {beforeEach, describe, expect, it, vi} from "vitest"

// Mock the Resend module
const mockSend = vi.fn()

vi.mock("resend", () => ({
    Resend: class MockResend {
        emails = {send: (...args: unknown[]) => mockSend(...args)}
    },
}))

// Mock the cloudflare context module
vi.mock("~/lib/cloudflare-context", () => ({
    cloudflareContext: Symbol("cloudflareContext"),
}))

// Import after mocks are set up
import * as security from "~/lib/security.server"
import {action} from "~/routes/api.feedback"

// Mock env object
const mockEnv = {
    YOTO_AUTH_SECRET: "test-secret-key-for-testing",
    RESEND_API_KEY: "test-resend-api-key",
    SANDBOX: {} as Env["SANDBOX"],
}

const mockContext = {
    get: vi.fn().mockReturnValue({env: mockEnv}),
}

const createFormData = (fields: Record<string, string>) => {
    const formData = new FormData()

    for (const [key, value] of Object.entries(fields)) {
        formData.set(key, value)
    }

    return formData
}

const callAction = (formData: FormData) => {
    return action({
        request: new Request("http://localhost/api/feedback", {
            method: "POST",
            body: formData,
        }),
        params: {},
        context: mockContext,
    } as unknown as Parameters<typeof action>[0])
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(security, "isValidOrigin").mockReturnValue(true)
})

describe("api/feedback action", () => {
    it("should return 403 when origin is invalid", async () => {
        vi.spyOn(security, "isValidOrigin").mockReturnValue(false)

        const formData = createFormData({
            category: "bug",
            message: "Something broke",
        })

        const response = await callAction(formData)

        expect(response.status).toBe(403)

        const data = (await response.json()) as {error?: string}
        expect(data.error).toBe("Forbidden")
        expect(mockSend).not.toHaveBeenCalled()
    })

    it("should return 400 when category is missing", async () => {
        const formData = createFormData({message: "Something broke"})
        const response = await callAction(formData)

        expect(response.status).toBe(400)

        const data = (await response.json()) as {
            error?: string
            success?: boolean
        }
        expect(data.error).toBe("Category and message are required.")
        expect(mockSend).not.toHaveBeenCalled()
    })

    it("should return 400 when message is missing", async () => {
        const formData = createFormData({category: "bug"})
        const response = await callAction(formData)

        expect(response.status).toBe(400)

        const data = (await response.json()) as {
            error?: string
            success?: boolean
        }
        expect(data.error).toBe("Category and message are required.")
        expect(mockSend).not.toHaveBeenCalled()
    })

    it("should return 400 when both category and message are missing", async () => {
        const formData = createFormData({})
        const response = await callAction(formData)

        expect(response.status).toBe(400)

        const data = (await response.json()) as {
            error?: string
            success?: boolean
        }
        expect(data.error).toBe("Category and message are required.")
        expect(mockSend).not.toHaveBeenCalled()
    })

    it("should send email and return success", async () => {
        mockSend.mockResolvedValue({id: "email-123"})

        const formData = createFormData({
            category: "bug",
            message: "The import button is broken",
            email: "user@example.com",
        })

        const response = await callAction(formData)

        expect(response.status).toBe(200)

        const data = (await response.json()) as {
            error?: string
            success?: boolean
        }
        expect(data.success).toBe(true)

        expect(mockSend).toHaveBeenCalledExactlyOnceWith({
            from: "Yoto Sync <feedback@yoto.bradgarropy.com>",
            to: "bradgarropy@gmail.com",
            subject: "Bug Report",
            text: [
                "Category: Bug Report",
                "Email: user@example.com",
                "",
                "Message:",
                "The import button is broken",
            ].join("\n"),
            html: expect.stringContaining("Bug Report"),
        })
    })

    it("should send email without reply email when not provided", async () => {
        mockSend.mockResolvedValue({id: "email-456"})

        const formData = createFormData({
            category: "feature",
            message: "Add dark mode",
        })

        const response = await callAction(formData)

        expect(response.status).toBe(200)

        const data = (await response.json()) as {
            error?: string
            success?: boolean
        }
        expect(data.success).toBe(true)

        expect(mockSend).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                subject: "Feature Request",
                text: expect.stringContaining("Email: Not provided"),
                html: expect.stringContaining("Not provided"),
            }),
        )
    })

    it("should use fallback subject for unknown category", async () => {
        mockSend.mockResolvedValue({id: "email-789"})

        const formData = createFormData({
            category: "unknown",
            message: "Some feedback",
        })

        const response = await callAction(formData)

        expect(response.status).toBe(200)

        expect(mockSend).toHaveBeenCalledWith(
            expect.objectContaining({
                subject: "Feedback",
            }),
        )
    })

    it("should return 500 when Resend throws an error", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {})
        mockSend.mockRejectedValue(new Error("Resend API error"))

        const formData = createFormData({
            category: "bug",
            message: "Something broke",
        })

        const response = await callAction(formData)

        expect(response.status).toBe(500)
        expect(console.error).toHaveBeenCalledOnce()

        const data = (await response.json()) as {
            error?: string
            success?: boolean
        }
        expect(data.error).toBe("Failed to send feedback. Please try again.")
    })
})
