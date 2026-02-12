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
| State Storage    | JSON files in `~/.config/yoto/`  |

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
│       ├── playlists.server.ts       # YouTube → Yoto associations
│       ├── tracks.server.ts          # Synced track history
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
5. Track info saved to `tracks.json` for skip detection

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

### tracks.json

```json
{
    "cardId123": {
        "videos": [
            {
                "youtubeVideoId": "dQw4w9WgXcQ",
                "syncedAt": "2026-02-03T12:00:00Z",
                "mediaId": "a1b2c3d4e5f6..."
            }
        ],
        "lastSynced": "2026-02-03T12:00:00Z"
    }
}
```

### playlists.json

```json
{
    "PLxxxxx": {
        "yotoId": "abc123",
        "yotoName": "My Playlist",
        "youtubeName": "YouTube Playlist",
        "lastSynced": "2026-02-03T12:00:00Z"
    }
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
- [ ] Card cover image customization
- [ ] Icon search for setting track icons (Phase 1: Yoto icons, Phase 2: yotoicons.com)
- [ ] Cloud hosting for remote access

## Icon Search

### Overview

Click on any track icon to open a modal that searches for icons. Implementation is split into two phases:

- **Phase 1:** Native Yoto icons only (from Yoto API)
- **Phase 2:** Add yotoicons.com community icons (~19,500+ icons)

### Phase 1: Native Yoto Icon Search

Search and select icons from Yoto's official icon library. The Yoto API provides icons with tags for searching.

#### Yoto API Discovery

The Yoto API has an endpoint for fetching all official icons:

```
GET https://api.yotoplay.com/media/displayIcons/user/yoto
Authorization: Bearer {jwt}

Response: {
  "displayIcons": [
    {
      "mediaId": "_WWpLHoOj6iqeREcGkJnGlsis2QSF6znM0UPFdXTjf8",
      "title": "Music notes",
      "publicTags": ["music", "note"],
      "url": "https://media-secure-v2.api.yotoplay.com/icons/...",
      "public": true,
      "userId": "yoto",
      "createdAt": "2020-08-25T00:17:17.285Z",
      "displayIconId": "5f44588d5d9e90000830f5c3"
    },
    // ... ~520 icons
  ]
}
```

Response time: ~840ms (acceptable for button-triggered search)

#### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Card Detail Page                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Track Row                                                   │ │
│  │  [Icon] ← clickable → opens IconPicker modal                │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    IconPicker Modal                              │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Search: [___________] [🔍]                                  │ │
│  │                                                             │ │
│  │ (Before search)                                             │ │
│  │ Search to find icons from Yoto's official library.          │ │
│  │                                                             │ │
│  │ (After search)                                              │ │
│  │ Yoto Icons (12 results)                                     │ │
│  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                   │ │
│  │ │icon│ │icon│ │icon│ │icon│ │icon│ │icon│                   │ │
│  │ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘                   │ │
│  │                                                             │ │
│  │ (No results)                                                │ │
│  │ No results found                                            │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │ select icon
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Server Action: updateTrackIcon                     │
│  1. For Yoto icons: mediaId = iconId (hash IS the mediaId)     │
│  2. Update chapter.display.icon16x16 = "yoto:#${mediaId}"       │
│  3. Call sdk.content.updateCard()                               │
└─────────────────────────────────────────────────────────────────┘
```

#### Files

| File                            | Purpose                                       |
| ------------------------------- | --------------------------------------------- |
| `app/lib/yoto-icons.server.ts`  | Fetch and search native Yoto icons from API   |
| `app/routes/api.icons.ts`       | Search endpoint                               |
| `app/components/IconPicker.tsx` | Modal UI for searching/selecting icons        |
| `app/routes/cards.$id.tsx`      | Add `updateTrackIcon` action, integrate modal |

#### yoto-icons.server.ts

```typescript
type YotoIcon = {
    id: string // mediaId (the hash)
    title: string
    tags: string[] // publicTags from API
    url: string
}

// Fetch all native Yoto icons from API
fetchYotoIcons(): Promise<YotoIcon[]>

// Search native Yoto icons by query (filters by tags)
searchYotoIcons(query: string): Promise<YotoIcon[]>
```

#### api.icons.ts

```
GET /api/icons?q=dog

Response: {
  yotoIcons: YotoIcon[]
}
```

#### IconPicker.tsx

- Search input + search button (triggers on click or Enter)
- Initial state: explainer text
- Icon grid (16x16 rendered at 32x32 with `imageRendering: pixelated`)
- Loading states
- "No results found" for empty results
- Click icon to select and close modal

#### cards.$id.tsx Changes

New action intent `updateTrackIcon`:

```typescript
case "updateTrackIcon": {
  const trackKey = formData.get("trackKey") as string
  const iconId = formData.get("iconId") as string

  // For Yoto icons, the hash IS the media ID
  const mediaId = iconId

  // Update the chapter's icon
  const chapter = card.content.chapters.find(c => c.key === trackKey)
  chapter.display = { ...chapter.display, icon16x16: `yoto:#${mediaId}` }

  await sdk.content.updateCard(card)
  return { success: true }
}
```

UI changes:

- Make track icon a clickable `<button>`
- Add state for `selectedTrackKey`
- Render `<IconPicker>` modal
- Handle selection via `useFetcher`

### Phase 2: Add yotoicons.com (Future)

Extend icon search to include community icons from yotoicons.com.

#### Additional Files

| File                                    | Purpose                   |
| --------------------------------------- | ------------------------- |
| `app/lib/yotoicons-community.server.ts` | Scrape yotoicons.com HTML |

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

#### yotoicons-community.server.ts

```typescript
type CommunityIcon = {
    id: string
    category: string
    tags: string[]
    author: string
    downloads: number
    url: string // https://yotoicons.com/static/uploads/{id}.png
}

// Search icons from yotoicons.com (scrapes HTML)
searchCommunityIcons(query: string, page?: number): Promise<{icons: CommunityIcon[], hasMore: boolean}>

// Fetch icon PNG as Buffer for upload to Yoto
fetchCommunityIconImage(iconId: string): Promise<Buffer>
```

#### Changes to Existing Files

**api.icons.ts:**

```
GET /api/icons?q=dog&page=1

Response: {
  yotoIcons: YotoIcon[],
  communityIcons: CommunityIcon[],
  communityError?: string,  // If yotoicons.com failed
  hasMore: boolean
}
```

**IconPicker.tsx:**

- Add "Community Icons" section below Yoto icons
- Add "Load More" button for pagination
- Show error message if yotoicons.com fails (still display Yoto results)

**cards.$id.tsx:**

```typescript
case "updateTrackIcon": {
  const iconType = formData.get("iconType") as "yoto" | "community"
  const iconId = formData.get("iconId") as string

  let mediaId: string

  if (iconType === "yoto") {
    // Yoto icons: hash IS the media ID
    mediaId = iconId
  } else {
    // Community icons: fetch PNG, upload to Yoto
    const imageBuffer = await fetchCommunityIconImage(iconId)
    const sha256 = computeSha256(imageBuffer)
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

  // Update chapter icon
  chapter.display = { ...chapter.display, icon16x16: `yoto:#${mediaId}` }
  await sdk.content.updateCard(card)
}
```

## YouTube Metadata Matching

Synced tracks are matched to Yoto chapters using `mediaId` - the content hash (transcodedSha256) from the track's `trackUrl`. This provides stable matching that survives track reordering, title changes, and duplicate titles.

**How it works:**

1. When a YouTube video is synced, the `mediaId` (extracted from `yoto:#<hash>` in the chapter's `trackUrl`) is stored in `tracks.json`
2. On the card detail page, each chapter's `mediaId` is extracted from its `trackUrl`
3. The synced track is looked up by `mediaId` to display YouTube metadata

**Migration:** Run `npx tsx scripts/migrate-tracks-mediaId.ts` to backfill `mediaId` for existing synced tracks.

## Scripts

### migrate-tracks-mediaId.ts

One-time migration script to backfill `mediaId` for existing synced tracks.

```bash
npx tsx scripts/migrate-tracks-mediaId.ts
```

The script:

1. Reads `tracks.json`
2. For each card, fetches chapter data from the Yoto API
3. Matches synced tracks to chapters by title
4. Extracts `mediaId` from each chapter's `trackUrl`
5. Updates `tracks.json` with the `mediaId` values
