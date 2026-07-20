import {vi} from "vitest"

vi.mock("cloudflare:workers", () => ({
    env: {
        ANALYTICS: {
            writeDataPoint: vi.fn(),
        },
    },
}))
