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
- [ ] yotoicons.com integration for setting track icons
- [ ] Cloud hosting for remote access

## Yotoicons.com Integration

### Overview

Search and select icons from [yotoicons.com](https://yotoicons.com) (community icon library with 19,500+ icons) and apply them to individual tracks on the card detail page.

### Architecture

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
│  │ Search: [___________] [Search]                              │ │
│  │                                                             │ │
│  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                          │ │
│  │ │icon│ │icon│ │icon│ │icon│ │icon│  ← from yotoicons.com    │ │
│  │ └────┘ └────┘ └────┘ └────┘ └────┘                          │ │
│  │                                                             │ │
│  │ [Load More]                                                 │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │ select icon
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Server Action: updateTrackIcon                     │
│  1. Fetch icon PNG from yotoicons.com                           │
│  2. Upload to Yoto media (get mediaId)                          │
│  3. Update chapter.display.icon16x16 = "yoto:#mediaId"          │
│  4. Call sdk.content.updateCard()                               │
└─────────────────────────────────────────────────────────────────┘
```

### Files

| File                            | Purpose                                       |
| ------------------------------- | --------------------------------------------- |
| `app/lib/yotoicons.server.ts`   | Scrape yotoicons.com HTML to extract icons    |
| `app/routes/api.yotoicons.ts`   | API endpoint for frontend to search icons     |
| `app/components/IconPicker.tsx` | Modal UI for searching/selecting icons        |
| `app/routes/cards.$id.tsx`      | Add `updateTrackIcon` action, integrate modal |

### How Yotoicons.com Works

1. **No public API** - Site requires scraping HTML (same approach as MYO Studio extension)
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

### Implementation Details

#### yotoicons.server.ts

```typescript
interface YotoIcon {
    id: string
    category: string
    tags: string[]
    author: string
    downloads: number
    url: string // https://yotoicons.com/static/uploads/{id}.png
}

// Search icons by tag/keyword
searchIcons(query: string, page?: number): Promise<{icons: YotoIcon[], hasMore: boolean}>

// Fetch icon image as Buffer for upload to Yoto
fetchIconImage(iconId: string): Promise<Buffer>
```

#### api.yotoicons.ts

```
GET /api/yotoicons?q=bluey&page=1
Response: { icons: YotoIcon[], hasMore: boolean }
```

#### IconPicker.tsx

- Search input (search on Enter or button click)
- Grid of icon thumbnails (16x16 rendered at 32x32 with pixelated rendering)
- "Load More" button for pagination
- Loading states
- Click icon to select and close modal

#### cards.$id.tsx Changes

New action intent `updateTrackIcon`:

1. Receive `trackKey` and `yotoIconId`
2. Fetch icon PNG from yotoicons.com
3. Compute SHA256 hash of image
4. Upload to Yoto via `sdk.media.getUploadUrlForTranscode()`
5. Update chapter: `display.icon16x16 = "yoto:#${mediaId}"`
6. Call `sdk.content.updateCard()`

UI changes:

- Wrap track icon in clickable button
- Open IconPicker modal on click
- Submit selected icon via fetcher

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
