import {beforeEach, describe, expect, it, vi} from "vitest"

// Mock SDK
const mockGetDisplayIcons = vi.fn()

vi.mock("./auth.server", () => ({
    getAuthenticatedSdk: vi.fn(() => ({
        sdk: {
            icons: {
                getDisplayIcons: mockGetDisplayIcons,
            },
        },
    })),
}))

// Import after mocks are set up
import {
    clearIconCache,
    fetchYotoIcons,
    getNumberIcons,
    searchYotoIcons,
} from "./yoto-icons.server"

// Create a mock Request for testing
const createMockRequest = () => new Request("https://example.com")

// Mock env object
const mockEnv = {
    YOTO_AUTH_SECRET: "test-secret-key-for-testing",
    SANDBOX: {} as Env["SANDBOX"],
}

beforeEach(() => {
    vi.clearAllMocks()
    clearIconCache()
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

        const result = await fetchYotoIcons(createMockRequest(), mockEnv)

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

        const result = await fetchYotoIcons(createMockRequest(), mockEnv)

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
        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "dog",
        )

        expect(result).toHaveLength(1)
        expect(result[0].title).toBe("Dog")
    })

    it("should filter by title with different case", async () => {
        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "DOG",
        )

        expect(result).toHaveLength(1)
        expect(result[0].title).toBe("Dog")
    })

    it("should filter by tags (case-insensitive)", async () => {
        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "animal",
        )

        expect(result).toHaveLength(2)
        expect(result.map(i => i.title)).toEqual(["Dog", "Cat"])
    })

    it("should filter by tags with different case", async () => {
        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "ANIMAL",
        )

        expect(result).toHaveLength(2)
    })

    it("should return empty array when no matches", async () => {
        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "xyz123notfound",
        )

        expect(result).toEqual([])
    })

    it("should match partial strings in title", async () => {
        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "music",
        )

        expect(result).toHaveLength(2)
        expect(result.map(i => i.title)).toEqual([
            "Music notes",
            "Musical instrument",
        ])
    })

    it("should match partial strings in tags", async () => {
        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "pet",
        )

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
        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "searchable",
        )

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
        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "Searchable",
        )

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
        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "valid",
        )

        expect(result).toHaveLength(1)
    })

    it("should dedupe icons with the same mediaId", async () => {
        const iconsWithDuplicates = [
            createMockIcon("abc123", "Music notes", ["music", "note"]),
            createMockIcon("abc123", "Music notes duplicate", ["music"]),
            createMockIcon("def456", "Dog", ["animal", "pet"]),
        ]
        mockGetDisplayIcons.mockResolvedValue(iconsWithDuplicates)

        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "music",
        )

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

        const result = await searchYotoIcons(
            createMockRequest(),
            mockEnv,
            "music",
        )

        expect(result).toHaveLength(1)
    })
})

describe("getNumberIcons", () => {
    it("should match 'Number - 1' (singular) title", async () => {
        mockGetDisplayIcons.mockResolvedValue([
            createMockIcon("num1-id", "Number - 1", ["1", "numbers"]),
        ])

        const result = await getNumberIcons(createMockRequest(), mockEnv)

        expect(result.get(1)).toBe("num1-id")
    })

    it("should match 'Numbers - N' (plural) titles", async () => {
        mockGetDisplayIcons.mockResolvedValue([
            createMockIcon("num2-id", "Numbers - 2", ["2", "numbers"]),
            createMockIcon("num10-id", "Numbers - 10", ["10", "numbers"]),
            createMockIcon("num30-id", "Numbers - 30", ["30", "numbers"]),
        ])

        const result = await getNumberIcons(createMockRequest(), mockEnv)

        expect(result.size).toBe(3)
        expect(result.get(2)).toBe("num2-id")
        expect(result.get(10)).toBe("num10-id")
        expect(result.get(30)).toBe("num30-id")
    })

    it("should return a complete 1-30 map when all number icons exist", async () => {
        const icons = [
            createMockIcon("id-1", "Number - 1", ["1", "numbers"]),
            ...Array.from({length: 29}, (_, i) =>
                createMockIcon(`id-${i + 2}`, `Numbers - ${i + 2}`, [
                    `${i + 2}`,
                    "numbers",
                ]),
            ),
        ]
        mockGetDisplayIcons.mockResolvedValue(icons)

        const result = await getNumberIcons(createMockRequest(), mockEnv)

        expect(result.size).toBe(30)
        for (let i = 1; i <= 30; i++) {
            expect(result.get(i)).toBe(`id-${i}`)
        }
    })

    it("should ignore non-number icon titles", async () => {
        mockGetDisplayIcons.mockResolvedValue([
            createMockIcon("num1-id", "Number - 1", ["1", "numbers"]),
            createMockIcon("music-id", "Music notes", ["music", "note"]),
            createMockIcon("dog-id", "Dog", ["animal", "pet"]),
            createMockIcon("radio-id", "01_MYO_radio_icon_test", [
                "icon",
                "radio",
                "1",
            ]),
        ])

        const result = await getNumberIcons(createMockRequest(), mockEnv)

        expect(result.size).toBe(1)
        expect(result.get(1)).toBe("num1-id")
    })

    it("should handle icons with null/undefined titles", async () => {
        mockGetDisplayIcons.mockResolvedValue([
            createMockIcon("null-title", null, ["numbers"]),
            createMockIcon("undef-title", undefined as unknown as string, [
                "numbers",
            ]),
            createMockIcon("num1-id", "Number - 1", ["1", "numbers"]),
        ])

        const result = await getNumberIcons(createMockRequest(), mockEnv)

        expect(result.size).toBe(1)
        expect(result.get(1)).toBe("num1-id")
    })

    it("should deduplicate by position (first match wins)", async () => {
        mockGetDisplayIcons.mockResolvedValue([
            createMockIcon("first-id", "Numbers - 5", ["5", "numbers"]),
            createMockIcon("dupe-id", "Numbers - 5", ["5", "numbers"]),
        ])

        const result = await getNumberIcons(createMockRequest(), mockEnv)

        expect(result.size).toBe(1)
        expect(result.get(5)).toBe("first-id")
    })

    it("should return an empty map when no number icons exist", async () => {
        mockGetDisplayIcons.mockResolvedValue([
            createMockIcon("music-id", "Music notes", ["music"]),
            createMockIcon("dog-id", "Dog", ["animal"]),
        ])

        const result = await getNumberIcons(createMockRequest(), mockEnv)

        expect(result.size).toBe(0)
    })

    it("should return an empty map when icon list is empty", async () => {
        mockGetDisplayIcons.mockResolvedValue([])

        const result = await getNumberIcons(createMockRequest(), mockEnv)

        expect(result.size).toBe(0)
    })
})
