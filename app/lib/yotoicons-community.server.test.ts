import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    fetchCommunityIconImage,
    searchCommunityIcons,
} from "./yotoicons-community.server"

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

beforeEach(() => {
    vi.clearAllMocks()
})

afterEach(() => {
    vi.restoreAllMocks()
})

// Helper to build HTML with icon data embedded in onclick handlers
const buildIconHtml = (
    icons: Array<{
        id: string
        category: string
        tag1: string
        tag2: string
        author: string
        downloads: string
    }>,
    totalCount?: number,
) => {
    const count = totalCount ?? icons.length
    const countStr = `We&#39;ve got ${count} icons with that tag:`
    const iconStr = icons
        .map(
            i =>
                `<div onclick="populate_icon_modal('${i.id}', '${i.category}', '${i.tag1}', '${i.tag2}', '${i.author}', '${i.downloads}')"></div>`,
        )
        .join("\n")
    return `<html><body>${countStr}\n${iconStr}</body></html>`
}

const mockFetchResponse = (body: string, ok = true, status = 200) => ({
    ok,
    status,
    statusText: ok ? "OK" : "Bad Request",
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
})

describe("searchCommunityIcons", () => {
    it("should parse icons from a single page of results", async () => {
        const html = buildIconHtml([
            {
                id: "844",
                category: "animals",
                tag1: "bluey",
                tag2: "",
                author: "californiafish",
                downloads: "6298",
            },
            {
                id: "100",
                category: "music",
                tag1: "guitar",
                tag2: "rock",
                author: "someuser",
                downloads: "123",
            },
        ])

        mockFetch.mockResolvedValueOnce(mockFetchResponse(html))

        const result = await searchCommunityIcons("test")

        expect(result.icons).toHaveLength(2)
        expect(result.icons[0]).toEqual({
            id: "844",
            category: "animals",
            tags: ["bluey"],
            author: "californiafish",
            downloads: 6298,
            url: "https://yotoicons.com/static/uploads/844.png",
        })
        expect(result.icons[1]).toEqual({
            id: "100",
            category: "music",
            tags: ["guitar", "rock"],
            author: "someuser",
            downloads: 123,
            url: "https://yotoicons.com/static/uploads/100.png",
        })
    })

    it("should filter out empty tag2 strings", async () => {
        const html = buildIconHtml([
            {
                id: "1",
                category: "misc",
                tag1: "hello",
                tag2: "",
                author: "user",
                downloads: "10",
            },
        ])

        mockFetch.mockResolvedValueOnce(mockFetchResponse(html))

        const result = await searchCommunityIcons("hello")

        expect(result.icons[0].tags).toEqual(["hello"])
    })

    it("should include both tags when tag2 is present", async () => {
        const html = buildIconHtml([
            {
                id: "1",
                category: "misc",
                tag1: "hello",
                tag2: "world",
                author: "user",
                downloads: "10",
            },
        ])

        mockFetch.mockResolvedValueOnce(mockFetchResponse(html))

        const result = await searchCommunityIcons("hello")

        expect(result.icons[0].tags).toEqual(["hello", "world"])
    })

    it("should return empty array when no icons match", async () => {
        const html = `<html><body>We&#39;ve got 0 icons with that tag:</body></html>`

        mockFetch.mockResolvedValueOnce(mockFetchResponse(html))

        const result = await searchCommunityIcons("nonexistent")

        expect(result.icons).toEqual([])
    })

    it("should fetch multiple pages when total count exceeds page size", async () => {
        // 30 total icons = 2 pages (25 + 5)
        const page1Icons = Array.from({length: 25}, (_, i) => ({
            id: `${i + 1}`,
            category: "cat",
            tag1: "tag",
            tag2: "",
            author: "user",
            downloads: "1",
        }))
        const page2Icons = Array.from({length: 5}, (_, i) => ({
            id: `${i + 26}`,
            category: "cat",
            tag1: "tag",
            tag2: "",
            author: "user",
            downloads: "1",
        }))

        const page1Html = buildIconHtml(page1Icons, 30)
        const page2Html = buildIconHtml(page2Icons, 30)

        mockFetch
            .mockResolvedValueOnce(mockFetchResponse(page1Html))
            .mockResolvedValueOnce(mockFetchResponse(page2Html))

        const result = await searchCommunityIcons("tag")

        expect(result.icons).toHaveLength(30)
        expect(result.icons[0].id).toBe("1")
        expect(result.icons[24].id).toBe("25")
        expect(result.icons[25].id).toBe("26")
        expect(result.icons[29].id).toBe("30")
        expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it("should not fetch additional pages when results fit in one page", async () => {
        const icons = Array.from({length: 10}, (_, i) => ({
            id: `${i + 1}`,
            category: "cat",
            tag1: "tag",
            tag2: "",
            author: "user",
            downloads: "1",
        }))
        const html = buildIconHtml(icons, 10)

        mockFetch.mockResolvedValueOnce(mockFetchResponse(html))

        const result = await searchCommunityIcons("tag")

        expect(result.icons).toHaveLength(10)
        expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("should not fetch additional pages when results equal page size", async () => {
        const icons = Array.from({length: 25}, (_, i) => ({
            id: `${i + 1}`,
            category: "cat",
            tag1: "tag",
            tag2: "",
            author: "user",
            downloads: "1",
        }))
        const html = buildIconHtml(icons, 25)

        mockFetch.mockResolvedValueOnce(mockFetchResponse(html))

        const result = await searchCommunityIcons("tag")

        expect(result.icons).toHaveLength(25)
        expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("should encode the query in the URL", async () => {
        const html = buildIconHtml([], 0)
        mockFetch.mockResolvedValueOnce(mockFetchResponse(html))

        await searchCommunityIcons("hello world")

        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining("tag=hello%20world"),
        )
    })

    it("should throw when yotoicons.com returns an error", async () => {
        mockFetch.mockResolvedValueOnce(mockFetchResponse("", false, 500))

        await expect(searchCommunityIcons("test")).rejects.toThrow(
            "yotoicons.com returned 500 for page 1",
        )
    })

    it("should calculate correct number of pages", async () => {
        // 75 icons = 3 pages (25 + 25 + 25)
        const pageIcons = Array.from({length: 25}, (_, i) => ({
            id: `${i + 1}`,
            category: "cat",
            tag1: "tag",
            tag2: "",
            author: "user",
            downloads: "1",
        }))
        const html = buildIconHtml(pageIcons, 75)

        mockFetch
            .mockResolvedValueOnce(mockFetchResponse(html))
            .mockResolvedValueOnce(mockFetchResponse(html))
            .mockResolvedValueOnce(mockFetchResponse(html))

        const result = await searchCommunityIcons("tag")

        // 3 pages × 25 icons each
        expect(result.icons).toHaveLength(75)
        expect(mockFetch).toHaveBeenCalledTimes(3)
    })
})

describe("fetchCommunityIconImage", () => {
    it("should fetch icon PNG and return a Buffer", async () => {
        const pngData = new Uint8Array([137, 80, 78, 71]) // PNG magic bytes
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(pngData.buffer),
        })

        const result = await fetchCommunityIconImage("844")

        expect(Buffer.isBuffer(result)).toBe(true)
        expect(result[0]).toBe(137)
        expect(result[1]).toBe(80)
        expect(mockFetch).toHaveBeenCalledWith(
            "https://yotoicons.com/static/uploads/844.png",
        )
    })

    it("should throw when fetch fails", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
        })

        await expect(fetchCommunityIconImage("999")).rejects.toThrow(
            "Failed to fetch community icon 999: 404",
        )
    })
})
