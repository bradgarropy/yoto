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
                "title": "Never Gonna Give You Up",
                "syncedAt": "2026-02-03T12:00:00Z",
                "yotoTrackKey": "abc123"
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
- [ ] yotoicons.com integration for setting track icons
- [ ] Cloud hosting for remote access
- [ ] Card cover image customization

## Known Limitations

- **YouTube metadata matching**: Synced tracks are matched to chapters by title. If a track's title is changed in Yoto after syncing, the YouTube metadata won't display.
- **Track key instability**: The `yotoTrackKey` stored in `tracks.json` can become stale when tracks are reordered or inserted in Yoto. Title matching is used instead for display purposes.
