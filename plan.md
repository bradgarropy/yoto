# Yoto Sync - Architecture

## Overview

A local web application for syncing YouTube content to Yoto cards. Built with React Router v7 running on Node.js.

## Tech Stack

| Component        | Technology                                    |
| ---------------- | --------------------------------------------- |
| Framework        | React Router v7 (Framework Mode)              |
| Runtime          | Cloudflare Workers                            |
| YouTube Download | yt-dlp via Cloudflare Containers (Sandbox DO) |
| UI               | shadcn/ui + Tailwind CSS v4                   |
| Auth             | @yotoplay/oauth-device-code-flow              |
| Auth Storage     | Encrypted HTTP-only cookie (AES-256-GCM)      |

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
- [x] Switch auth storage from `auth.json` to encrypted HTTP-only cookies (removes last filesystem dependency)
- [x] Cloud hosting for remote access (Cloudflare Workers + Containers)
- [x] Remove Hono dependency (use standard React Router + Cloudflare pattern)
