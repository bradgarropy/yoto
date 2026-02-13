import pLimit from "p-limit"

type CommunityIcon = {
    id: string
    category: string
    tags: string[]
    author: string
    downloads: number
    url: string // https://yotoicons.com/static/uploads/{id}.png
}

const BASE_URL = "https://yotoicons.com"
const PAGE_SIZE = 25
const CONCURRENCY_LIMIT = 5

// Regex to extract icon data from onclick handlers:
// populate_icon_modal("844", "animals", "bluey", "", "californiafish", "6298")
const ICON_DATA_REGEX =
    /populate_icon_modal\('(\d+)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'(\d+)'\)/g

// Regex to extract total count from HTML:
// We&#39;ve got 321 icons with that tag:
const TOTAL_COUNT_REGEX = /We&#39;ve got (\d+) icons/

// Parse icon data from HTML page content
const parseIconsFromHtml = (html: string): CommunityIcon[] => {
    const icons: CommunityIcon[] = []

    let match
    // Reset regex lastIndex for safety
    ICON_DATA_REGEX.lastIndex = 0

    while ((match = ICON_DATA_REGEX.exec(html)) !== null) {
        const [, id, category, tag1, tag2, author, downloads] = match
        icons.push({
            id,
            category,
            tags: [tag1, tag2].filter(Boolean),
            author,
            downloads: parseInt(downloads, 10),
            url: `${BASE_URL}/static/uploads/${id}.png`,
        })
    }

    return icons
}

// Parse total icon count from HTML
const parseTotalCount = (html: string): number => {
    const match = html.match(TOTAL_COUNT_REGEX)
    return match ? parseInt(match[1], 10) : 0
}

// Fetch a single page of search results from yotoicons.com
const fetchPage = async (
    query: string,
    page: number,
): Promise<{html: string}> => {
    const url = `${BASE_URL}/icons?tag=${encodeURIComponent(query)}&sort=popular&type=singles&page=${page}`
    const response = await fetch(url)

    if (!response.ok) {
        throw new Error(
            `yotoicons.com returned ${response.status} for page ${page}`,
        )
    }

    const html = await response.text()
    return {html}
}

// Search all icons from yotoicons.com (scrapes HTML, fetches all pages)
// Uses p-limit(5) for parallel page fetching with concurrency control
const searchCommunityIcons = async (
    query: string,
): Promise<{icons: CommunityIcon[]}> => {
    // Fetch page 1 to get total count
    const {html: firstPageHtml} = await fetchPage(query, 1)
    const totalCount = parseTotalCount(firstPageHtml)
    const firstPageIcons = parseIconsFromHtml(firstPageHtml)

    if (totalCount <= PAGE_SIZE) {
        return {icons: firstPageIcons}
    }

    // Calculate remaining pages
    const totalPages = Math.ceil(totalCount / PAGE_SIZE)
    const remainingPages = Array.from({length: totalPages - 1}, (_, i) => i + 2)

    // Fetch remaining pages in parallel with concurrency limit
    const limit = pLimit(CONCURRENCY_LIMIT)
    const pagePromises = remainingPages.map(page =>
        limit(async () => {
            const {html} = await fetchPage(query, page)
            return parseIconsFromHtml(html)
        }),
    )

    const results = await Promise.all(pagePromises)
    const allIcons = [firstPageIcons, ...results].flat()

    return {icons: allIcons}
}

// Fetch icon PNG as Buffer for upload to Yoto
const fetchCommunityIconImage = async (iconId: string): Promise<Buffer> => {
    const url = `${BASE_URL}/static/uploads/${iconId}.png`
    const response = await fetch(url)

    if (!response.ok) {
        throw new Error(
            `Failed to fetch community icon ${iconId}: ${response.status}`,
        )
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
}

export {fetchCommunityIconImage, searchCommunityIcons}
export type {CommunityIcon}
