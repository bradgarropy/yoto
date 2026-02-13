# Yoto Sync - Architecture

## Overview

A local web application for syncing YouTube content to Yoto cards. Built with React Router v7 running on Node.js.

## Tech Stack

| Component        | Technology                       |
| ---------------- | -------------------------------- |
| Framework        | React Router v7 (Framework Mode) |
| Server           | Node.js (local only)             |
| UI               | shadcn/ui + Tailwind CSS v4      |
| Auth             | @yotoplay/oauth-device-code-flow |
| YouTube Download | yt-dlp                           |
| Auth Storage     | `~/.config/yoto/auth.json`       |

## Project Structure

```
yoto/
├── app/
│   ├── root.tsx                      # Layout with header
│   ├── routes.ts                     # Route definitions
│   ├── routes/
│   │   ├── home.tsx                  # Dashboard (card grid)
│   │   ├── login.tsx                 # Device code auth
│   │   ├── cards.$id.tsx             # Card detail (track list)
│   │   └── api.import.$cardId.tsx    # Streaming import endpoint
│   ├── components/ui/                # shadcn components
│   └── lib/
│       ├── auth.server.ts            # Token management, SDK creation
│       ├── paths.server.ts           # Config file paths
│       ├── youtube.server.ts         # yt-dlp wrapper
│       ├── sync.server.ts            # Upload and sync logic
│       └── sync-utils.ts             # Chapter helpers
├── public/                           # Static assets (favicon)
└── images/                           # Card placeholder images
```

## Routes

| Route                 | Purpose                     |
| --------------------- | --------------------------- |
| `/`                   | Card grid with search/sort  |
| `/login`              | Device code authentication  |
| `/cards/:id`          | Card detail with track list |
| `/api/import/:cardId` | Streaming import endpoint   |

## Data Flow

### Authentication

1. User clicks Login → Device code flow initiated
2. User visits URL, enters code, approves in browser
3. Tokens saved to `~/.config/yoto/auth.json`
4. SDK created with JWT for API calls

### YouTube Import

1. User pastes YouTube URL on card detail page
2. `youtube.server.ts` extracts video/playlist info via yt-dlp
3. Each track: download → transcode → upload to Yoto
4. Card updated with new chapters

## Config Files

All stored in `~/.config/yoto/`:

### auth.json

```json
{
    "accessToken": "eyJhbG...",
    "refreshToken": "...",
    "expiresAt": 1769830490,
    "tokenType": "Bearer"
}
```

## External Dependencies

### Yoto API

- `@yotoplay/yoto-sdk` - Content and media operations
- `@yotoplay/oauth-device-code-flow` - Authentication

### System Requirements

- Node.js v20+
- yt-dlp (via Homebrew: `brew install yt-dlp`)
- ffmpeg (via Homebrew: `brew install ffmpeg`)

## Future Enhancements

- [x] Display track icons on card detail page (from Yoto API `display.icon16x16`)
- [x] Card cover image customization
- [x] Icon search for setting track icons (Phase 1: Yoto icons)
- [x] Icon search for setting track icons (Phase 2: yotoicons.com)
- [x] Auto-number track icons (set each track to the official Yoto number icon matching its position)
- [x] Move "Add Tracks" form to a button in the action toolbar
- [ ] Cloud hosting for remote access

## Icon Search

### Overview

Click on any track icon to open a modal that searches for icons. Implementation is split into two phases:

- **Phase 1:** Native Yoto icons only (from Yoto API)
- **Phase 2:** Add yotoicons.com community icons (~19,500+ icons)

### Phase 1: Native Yoto Icon Search ✅

Search and select icons from Yoto's official icon library. The Yoto SDK provides `sdk.icons.getDisplayIcons()` for fetching icons with tags for searching.

#### Implementation Notes

- Uses `@yotoplay/yoto-sdk` method `sdk.icons.getDisplayIcons()` (~520 icons)
- Search filters by title and tags (case-insensitive)
- Results are deduped by mediaId (API returns some duplicates)
- Icons displayed on dark background (`bg-zinc-900`) for better visibility
- Uses controlled Dialog pattern with DialogTrigger for accessibility

**Important:** When updating icons, must update BOTH `chapter.display.icon16x16` AND `chapter.tracks[].display.icon16x16`. The Yoto website reads from the track-level display, not just chapter-level.

#### Files

| File                            | Purpose                                         |
| ------------------------------- | ----------------------------------------------- |
| `app/lib/yoto-icons.server.ts`  | Fetch and search native Yoto icons via SDK      |
| `app/routes/api.icons.ts`       | `GET /api/icons?q=<query>` search endpoint      |
| `app/components/IconPicker.tsx` | `IconPickerContent` - search form and icon grid |
| `app/routes/cards.$id.tsx`      | `updateTrackIcon` action, Dialog integration    |

#### API

```
GET /api/icons?q=dog

Response: {
  yotoIcons: YotoIcon[]
}
```

#### YotoIcon Type

```typescript
type YotoIcon = {
    id: string // mediaId (the hash)
    title: string
    tags: string[] // publicTags from API
    url: string
}
```

### Phase 2: Add yotoicons.com

Extend icon search to include community icons from yotoicons.com (~19,500+ icons).

#### How yotoicons.com Works

1. **No public API** - Site requires scraping HTML
2. **Icon data in HTML** - Embedded in `onclick` handlers:
    ```javascript
    populate_icon_modal("844", "animals", "bluey", "", "californiafish", "6298")
    // params: (id, category, tag1, tag2, author, downloads)
    ```
3. **Direct PNG access** - Icons publicly accessible at:
    ```
    https://yotoicons.com/static/uploads/{id}.png
    ```
4. **Search via URL params**:
    ```
    /icons?tag={search}&sort={popular|new}&type={singles|packs}&page={n}
    ```
5. **Fixed page size of 25** - No `limit`, `count`, `per_page`, or `size` query params are supported. The page size is hardcoded server-side.
6. **Total count in HTML** - The page includes a count string: `We&#39;ve got 321 icons with that tag:` which can be parsed to determine total pages.
7. **Pagination in JS** - The page's JavaScript calculates `Math.ceil(totalCount / 25)` for total pages.

#### Fetching Strategy

To match the MYO Extension behavior (which loads all results at once), the server fetches all pages in parallel with a concurrency limit:

1. Fetch page 1 to get the total count
2. Calculate remaining pages: `Math.ceil(totalCount / 25) - 1`
3. Fetch remaining pages in parallel using `p-limit(5)` for concurrency control
4. Flatten and return all icons

This keeps searches fast (~1-2s for most queries) while being respectful of yotoicons.com's server.

#### New Dependency

- `p-limit` - Promise concurrency limiter for parallel page fetches

#### Files

| File                                    | Purpose                                              |
| --------------------------------------- | ---------------------------------------------------- |
| `app/lib/yotoicons-community.server.ts` | Scrape and search yotoicons.com HTML (new file)      |
| `app/routes/api.icons.ts`               | Add community icon search alongside Yoto icons       |
| `app/components/IconPicker.tsx`         | Add community icons section, union type for onSelect |
| `app/routes/cards.$id.tsx`              | Handle community icon upload flow in updateTrackIcon |

#### yotoicons-community.server.ts (new file)

```typescript
type CommunityIcon = {
    id: string
    category: string
    tags: string[]
    author: string
    downloads: number
    url: string // https://yotoicons.com/static/uploads/{id}.png
}

// Search all icons from yotoicons.com (scrapes HTML, fetches all pages)
// Uses p-limit(5) for parallel page fetching with concurrency control
searchCommunityIcons(query: string): Promise<{icons: CommunityIcon[]}>

// Fetch icon PNG as Buffer for upload to Yoto
fetchCommunityIconImage(iconId: string): Promise<Buffer>
```

**HTML parsing approach:**

- Regex for icon data: `populate_icon_modal\('(\d+)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'(\d+)'\)`
    - Captures: `(id, category, tag1, tag2, author, downloads)`
- Regex for total count: `We&#39;ve got (\d+) icons`
- Tags array built from `[tag1, tag2].filter(Boolean)` (tag2 can be empty string)

#### Changes to Existing Files

**api.icons.ts:**

- Import `searchCommunityIcons`
- Call `searchYotoIcons` and `searchCommunityIcons` in parallel via `Promise.allSettled`
- If community search fails, set `communityError` but still return Yoto results

```
GET /api/icons?q=dog

Response: {
  yotoIcons: YotoIcon[],
  communityIcons: CommunityIcon[],
  communityError?: string,  // If yotoicons.com is down/failed
}
```

**IconPicker.tsx:**

- Import `CommunityIcon` type
- Update `IconsResponse` to include `communityIcons` and `communityError`
- Change `onSelect` prop to accept a union type with discriminator:

    ```typescript
    type IconSelection =
        | ({type: "yoto"} & YotoIcon)
        | ({type: "community"} & CommunityIcon)

    type IconPickerContentProps = {
        onSelect: (icon: IconSelection) => void
    }
    ```

- Add "Community Icons" section below "Yoto Icons" with count label and same grid layout
- Community icon images use `url` directly (public PNGs, no signed URL needed)
- Show graceful error if `communityError` present (still display Yoto results)
- Scrollable results area so modal doesn't get excessively tall with many results

**cards.$id.tsx:**

- Import `CommunityIcon` type and `fetchCommunityIconImage`
- Update `handleIconSelect` to detect `icon.type` and submit `iconType` ("yoto" | "community") alongside `iconId`
- Update `updateTrackIcon` action:

```typescript
case "updateTrackIcon": {
  const iconType = (formData.get("iconType") as "yoto" | "community") ?? "yoto"
  const iconId = formData.get("iconId") as string

  let mediaId: string

  if (iconType === "yoto") {
    // Yoto icons: hash IS the media ID
    mediaId = iconId
  } else {
    // Community icons: fetch PNG, upload to Yoto
    const imageBuffer = await fetchCommunityIconImage(iconId)
    const sha256 = createHash("sha256").update(imageBuffer).digest("hex")
    const uploadInfo = await sdk.media.getUploadUrlForTranscode(sha256, `${iconId}.png`)
    if (uploadInfo.uploadUrl) {
      await fetch(uploadInfo.uploadUrl, {
        method: "PUT",
        body: imageBuffer,
        headers: { "Content-Type": "image/png" }
      })
    }
    mediaId = sha256
  }

  // Update chapter icon (both chapter-level and track-level)
  chapter.display = { ...chapter.display, icon16x16: `yoto:#${mediaId}` }
  chapter.tracks.forEach(t => t.display = { ...t.display, icon16x16: `yoto:#${mediaId}` })
  await sdk.content.updateCard(card)
}
```

#### Data Flow

```
User searches "dog"
  → GET /api/icons?q=dog
    → Promise.allSettled([
        searchYotoIcons("dog"),         // ~520 cached icons, filtered locally
        searchCommunityIcons("dog"),    // scrapes yotoicons.com (all pages, p-limit=5)
      ])
    → { yotoIcons: [...], communityIcons: [...] }
  → IconPicker renders both sections

User clicks a community icon
  → POST cards.$id.tsx {
      intent: "updateTrackIcon",
      iconType: "community",
      iconId: "104",
      trackKey: "..."
    }
    → fetchCommunityIconImage("104")         // GET yotoicons.com/static/uploads/104.png
    → createHash("sha256").update(buffer)    // compute hash
    → sdk.media.getUploadUrlForTranscode()   // get upload URL from Yoto
    → PUT buffer to uploadUrl                // upload PNG to Yoto
    → update chapter display.icon16x16 = "yoto:#${sha256}"
```

## Card Cover Image Customization ✅

### Overview

Click the card cover image on the card detail page (`/cards/:id`) to open a dialog for uploading a custom cover image. The image is uploaded to Yoto's cover image API, and the card metadata is updated with the returned URL.

### Yoto Cover Image API

```
POST https://api.yotoplay.com/media/coverImage/user/me/upload?autoconvert=true&coverType=default
Authorization: Bearer ${token}
Content-Type: image/jpeg (or image/png)
Body: image file bytes

Response: {
  "coverImage": {
    "mediaId": "...",
    "mediaUrl": "https://card-content.aws.fooropa.com/..."
  }
}
```

The `autoconvert=true` parameter tells Yoto to automatically resize and process the image to the appropriate cover image dimensions. The returned `mediaUrl` is stored in `metadata.cover.imageL` on the card.

**Note:** The SDK does not have a method for this endpoint. It is called directly via `fetch` using `getToken()` for the bearer token, following the same pattern as the community icon upload.

### Files

| File                           | Purpose                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `app/components/CardCover.tsx` | Shared cover component with `49:78` aspect ratio, parallax hover effect, and exported `CARD_ASPECT_RATIO` constant |
| `app/routes/cards.$id.tsx`     | `updateCover` action, cover upload Dialog, `coverFetcher`                                                          |

### Data Flow

```
User clicks cover image on /cards/:id
  → Dialog opens with file input
  → User selects image file (preview shown in 49:78 aspect ratio)
  → User clicks "Upload" (button shows "Uploading...", inputs disabled, dialog locked)
  → POST cards.$id.tsx { intent: "updateCover", coverFile: File }
    → Read file bytes from FormData
    → POST to Yoto cover image API (autoconvert=true)
    → Get back { coverImage: { mediaId, mediaUrl } }
    → Set card.metadata.cover.imageL = mediaUrl
    → sdk.content.updateCard(card)
  → Dialog closes, toast shows "Cover image updated"
  → Loader revalidates, new cover URL displayed
```

### Dialog UX Pattern

Both the cover upload dialog and icon picker dialog follow the same pattern for async operations:

- **During upload:** Inputs disabled, submit button shows loading text, dialog cannot be closed (Escape, overlay click, and X button are blocked)
- **On completion:** Dialog closes automatically, toast notification shown
- **No flash on close:** Loading state persists through the dialog close animation (state is not cleared until the dialog fully closes or reopens)

## Auto-Number Track Icons ✅

### Overview

One-click button to set each track's icon to the official Yoto number icon matching its position (track 1 gets "1", track 2 gets "2", etc.). Available in a toolbar row above the track list alongside the Delete Card button.

### How Number Icons Are Identified

Yoto's official icon library (~520 icons) includes number icons 1-30 with titles following the pattern `"Number - 1"` (singular for 1) and `"Numbers - N"` (plural for 2-30). Each has a `"numbers"` tag and a tag matching the number string (e.g., `"1"`, `"2"`).

The `getNumberIcons()` function uses the regex `/^Numbers?\s*-\s*(\d+)$/` to identify these icons and maps position numbers to their `mediaId` values.

### Files

| File                           | Purpose                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| `app/lib/yoto-icons.server.ts` | `getNumberIcons()` - returns `Map<number, string>` (position → mediaId) |
| `app/routes/cards.$id.tsx`     | `numberTracks` action, toolbar UI with confirmation dialog              |

### Data Flow

```
User clicks "Number Tracks" button
  → Confirmation dialog: "This will set each track's icon to its position number"
  → User confirms
  → POST cards.$id.tsx { intent: "numberTracks" }
    → getNumberIcons() fetches all Yoto icons, filters by "Numbers? - N" title pattern
    → Returns Map<number, string> (position → mediaId)
    → For each chapter at index i: set display.icon16x16 = "yoto:#${numberIcons.get(i+1)}"
    → Updates both chapter.display and chapter.tracks[].display
    → Single sdk.content.updateCard() call
  → Toast: "Track icons numbered"
  → Loader revalidates, numbered icons displayed
```

### Edge Cases

- Tracks beyond position 30 are left unchanged (Yoto provides number icons 1-30)
- Button disabled when no tracks exist or another operation is in progress
- If number icons can't be found (API failure), returns error

## Cloudflare Migration (Exploration)

### Motivation

Host the app on Cloudflare for remote access and multi-user support. Currently runs as a local Node.js app with filesystem-based state.

### Removed tracks.json and playlists.json ✅

The `tracks.json` skip-detection mechanism and `playlists.json` associations were removed because:

- **Simple workflow**: Delete a track, add a track via YouTube URL, or add multiple tracks via playlist URL
- **Not incremental sync**: No need to track what's been synced before
- **Redundant data**: The `mediaId` for track deletion is available from the Yoto API (in each chapter's `trackUrl` as `yoto:#<hash>`)
- **Cloudflare prep**: Removes filesystem dependencies for future cloud hosting

**Files removed:**

| File                                | Reason                           |
| ----------------------------------- | -------------------------------- |
| `app/lib/tracks.server.ts`          | All CRUD for tracks.json         |
| `app/lib/tracks.server.test.ts`     | Tests for tracks.server.ts       |
| `app/lib/playlists.server.ts`       | All CRUD for playlists.json      |
| `app/lib/playlists.server.test.ts`  | Tests for playlists.server.ts    |
| `scripts/migrate-tracks-mediaId.ts` | Migration script for tracks.json |

**Files modified:**

| File                       | Changes                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `app/lib/paths.server.ts`  | Removed `TRACKS_FILE` and `PLAYLISTS_FILE` exports               |
| `app/routes/home.tsx`      | Replaced local `lastSynced` with Yoto API's `updatedAt` for sort |
| `app/routes/cards.$id.tsx` | Removed imports and calls to track functions                     |
| `app/lib/sync.server.ts`   | Removed skip detection and playlist association logic            |

**Sort by Updated**: The home page "Sort by Updated" feature now uses the `updatedAt` field from the Yoto API instead of locally tracked `lastSynced`. This reflects any card edit (not just YouTube imports), which is more accurate.

### Cloudflare Compatibility Issues

| Issue                                                                  | Severity    | Solution                                      |
| ---------------------------------------------------------------------- | ----------- | --------------------------------------------- |
| **yt-dlp/FFmpeg** (can't run binaries in Workers)                      | BLOCKER     | Cloudflare Containers                         |
| **child_process spawn** (not in Workers runtime)                       | BLOCKER     | Cloudflare Containers                         |
| **Long-running imports** (Workers 30s limit, imports can take minutes) | BLOCKER     | Cloudflare Containers                         |
| ~~**File system storage** (tracks, playlists)~~                        | ~~BLOCKER~~ | ~~Removed tracks.json and playlists.json~~ ✅ |
| **File system storage** (auth tokens)                                  | BLOCKER     | KV for auth, or encrypted cookie              |
| **TokenManager uses fs** (`@yotoplay/oauth-device-code-flow`)          | BLOCKER     | Custom token adapter with KV, or cookie-based |
| **React Router Node adapter** (`@react-router/node`)                   | MEDIUM      | Switch to `@react-router/cloudflare`          |
| **Buffer usage**                                                       | LOW         | Use `Uint8Array`                              |
| **crypto.createHash**                                                  | LOW         | Use Web Crypto API                            |

### Proposed Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Cloudflare Pages                       │
│              (React Router frontend + SSR)                │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  Cloudflare Workers                      │
│         (API routes, auth, orchestration)                │
│                                                          │
│  Storage:                                                │
│  - Encrypted cookie: Yoto auth tokens                    │
│  - KV: optional metadata (if needed later)               │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Cloudflare Container                        │
│                                                          │
│  - yt-dlp + FFmpeg installed                             │
│  - Downloads YouTube audio → returns MP3                 │
│  - Fetches playlist/video metadata                       │
│  - Stateless, spins up per-job                           │
└─────────────────────────────────────────────────────────┘
```

### Auth Strategy

For multi-user support, store Yoto OAuth tokens in an **encrypted HTTP-only cookie**:

- Token is small enough to fit in a cookie (~4KB limit)
- Stateless - no KV reads needed per request
- Each user "owns" their token
- Token refresh: when token expires, refresh and update the cookie in the response

### Import Flow

```
1. User pastes YouTube URL
         ↓
2. Worker validates URL, invokes Container
         ↓
3. Container: yt-dlp --dump-json → returns track metadata
         ↓
4. Worker streams SSE to client: "Found N tracks..."
         ↓
5. For each track:
   a. Worker → Container: "Download track X"
   b. Container: yt-dlp + ffmpeg → MP3 stream
   c. Worker: Upload MP3 to Yoto API
   d. Worker: Poll Yoto for transcode completion
   e. Worker → Client: SSE "Track X complete"
         ↓
6. Done
```

### Open Questions

- **yt-dlp cookies**: Current code uses `--cookies-from-browser chrome` for age-restricted content. This won't work in a Container. Need to test if it's required or can be dropped.
- **Container invocation model**: HTTP service? Direct RPC binding? Queue consumer? Need to confirm the API pattern.
- **Container timeouts**: The import process can take several minutes. Need to confirm Container timeout limits vs Workers limits.
