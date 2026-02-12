import {beforeEach, describe, expect, it, vi} from "vitest"

// Mock SDK
const mockGetDisplayIcons = vi.fn()

vi.mock("./auth.server", () => ({
    getAuthenticatedSdk: vi.fn(() => ({
        icons: {
            getDisplayIcons: mockGetDisplayIcons,
        },
    })),
}))

// Import after mocks are set up
import {fetchYotoIcons, searchYotoIcons} from "./yoto-icons.server"

beforeEach(() => {
    vi.clearAllMocks()
})

const createMockIcon = (
    mediaId: string,
    title: string | null,
    publicTags: string[] | null,
) => ({
    mediaId,
    title,
    publicTags,
    url: `https://media.yotoplay.com/icons/${mediaId}`,
    public: true,
    userId: "yoto",
    createdAt: "2020-08-25T00:17:17.285Z",
    displayIconId: `display-${mediaId}`,
})

describe("fetchYotoIcons", () => {
    it("should fetch icons and transform them to YotoIcon format", async () => {
        const mockIcons = [
            createMockIcon("abc123", "Music notes", ["music", "note"]),
            createMockIcon("def456", "Dog", ["animal", "pet"]),
        ]
        mockGetDisplayIcons.mockResolvedValue(mockIcons)

        const result = await fetchYotoIcons()

        expect(result).toEqual([
            {
                id: "abc123",
                title: "Music notes",
                tags: ["music", "note"],
                url: "https://media.yotoplay.com/icons/abc123",
            },
            {
                id: "def456",
                title: "Dog",
                tags: ["animal", "pet"],
                url: "https://media.yotoplay.com/icons/def456",
            },
        ])
    })

    it("should handle empty response", async () => {
        mockGetDisplayIcons.mockResolvedValue([])

        const result = await fetchYotoIcons()

        expect(result).toEqual([])
    })
})

describe("searchYotoIcons", () => {
    const mockIcons = [
        createMockIcon("abc123", "Music notes", ["music", "note"]),
        createMockIcon("def456", "Dog", ["animal", "pet"]),
        createMockIcon("ghi789", "Cat", ["animal", "pet"]),
        createMockIcon("jkl012", "Musical instrument", ["instrument"]),
    ]

    beforeEach(() => {
        mockGetDisplayIcons.mockResolvedValue(mockIcons)
    })

    it("should filter by title (case-insensitive)", async () => {
        const result = await searchYotoIcons("dog")

        expect(result).toHaveLength(1)
        expect(result[0].title).toBe("Dog")
    })

    it("should filter by title with different case", async () => {
        const result = await searchYotoIcons("DOG")

        expect(result).toHaveLength(1)
        expect(result[0].title).toBe("Dog")
    })

    it("should filter by tags (case-insensitive)", async () => {
        const result = await searchYotoIcons("animal")

        expect(result).toHaveLength(2)
        expect(result.map(i => i.title)).toEqual(["Dog", "Cat"])
    })

    it("should filter by tags with different case", async () => {
        const result = await searchYotoIcons("ANIMAL")

        expect(result).toHaveLength(2)
    })

    it("should return empty array when no matches", async () => {
        const result = await searchYotoIcons("xyz123notfound")

        expect(result).toEqual([])
    })

    it("should match partial strings in title", async () => {
        const result = await searchYotoIcons("music")

        expect(result).toHaveLength(2)
        expect(result.map(i => i.title)).toEqual([
            "Music notes",
            "Musical instrument",
        ])
    })

    it("should match partial strings in tags", async () => {
        const result = await searchYotoIcons("pet")

        expect(result).toHaveLength(2)
        expect(result.map(i => i.title)).toEqual(["Dog", "Cat"])
    })

    it("should handle icons with null title", async () => {
        const iconsWithNullTitle = [
            ...mockIcons,
            createMockIcon("null-title", null, ["searchable"]),
        ]
        mockGetDisplayIcons.mockResolvedValue(iconsWithNullTitle)

        // Should not throw and should find by tag
        const result = await searchYotoIcons("searchable")

        expect(result).toHaveLength(1)
        expect(result[0].id).toBe("null-title")
    })

    it("should handle icons with null tags", async () => {
        const iconsWithNullTags = [
            ...mockIcons,
            createMockIcon("null-tags", "Searchable Title", null),
        ]
        mockGetDisplayIcons.mockResolvedValue(iconsWithNullTags)

        // Should not throw and should find by title
        const result = await searchYotoIcons("Searchable")

        expect(result).toHaveLength(1)
        expect(result[0].id).toBe("null-tags")
    })

    it("should handle icons with null tag values", async () => {
        const iconsWithNullTagValue = [
            createMockIcon("mixed-tags", "Test", [
                "valid",
                null as unknown as string,
                "also-valid",
            ]),
        ]
        mockGetDisplayIcons.mockResolvedValue(iconsWithNullTagValue)

        // Should not throw and should find by valid tag
        const result = await searchYotoIcons("valid")

        expect(result).toHaveLength(1)
    })

    it("should dedupe icons with the same mediaId", async () => {
        const iconsWithDuplicates = [
            createMockIcon("abc123", "Music notes", ["music", "note"]),
            createMockIcon("abc123", "Music notes duplicate", ["music"]),
            createMockIcon("def456", "Dog", ["animal", "pet"]),
        ]
        mockGetDisplayIcons.mockResolvedValue(iconsWithDuplicates)

        const result = await searchYotoIcons("music")

        // Should only have one icon with mediaId abc123
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe("abc123")
        expect(result[0].title).toBe("Music notes") // First one wins
    })

    it("should dedupe across title and tag matches", async () => {
        const iconsWithDuplicates = [
            createMockIcon("abc123", "Music", ["song"]),
            createMockIcon("abc123", "Song", ["music"]), // Same id, different match path
        ]
        mockGetDisplayIcons.mockResolvedValue(iconsWithDuplicates)

        const result = await searchYotoIcons("music")

        expect(result).toHaveLength(1)
    })
})
