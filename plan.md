# Yoto Sync - Architecture

## Overview

A web application for syncing YouTube content to Yoto cards. Built with React Router v7 running on Cloudflare Workers.

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
│   │   ├── api.import.$cardId.tsx    # Streaming import endpoint
│   │   └── api.icons.ts              # Icon search endpoint
│   ├── components/ui/                # shadcn components
│   ├── middleware/
│   │   └── auth.server.ts            # Auth middleware
│   └── lib/
│       ├── auth.server.ts            # Token management, SDK creation
│       ├── auth-cookie.server.ts     # Encrypted cookie storage
│       ├── cloudflare-context.ts     # Cloudflare env/ctx access
│       ├── sandbox.server.ts         # Cloudflare Containers client
│       ├── youtube.server.ts         # yt-dlp integration
│       ├── sync.server.ts            # Upload and sync logic
│       └── sync-utils.ts             # Chapter helpers
├── workers/
│   └── app.ts                        # Cloudflare Workers entry point
└── public/                           # Static assets (favicon)
```

## Routes

| Route                 | Purpose                     |
| --------------------- | --------------------------- |
| `/`                   | Card grid with search/sort  |
| `/login`              | Device code authentication  |
| `/cards/:id`          | Card detail with track list |
| `/api/import/:cardId` | Streaming import endpoint   |
| `/api/icons`          | Icon search endpoint        |

## Data Flow

### Authentication

1. User clicks Login → Device code flow initiated
2. User visits URL, enters code, approves in browser
3. Tokens encrypted and stored in HTTP-only cookie
4. SDK created with JWT for API calls

### YouTube Import

1. User pastes YouTube URL on card detail page
2. Sandbox container runs yt-dlp to extract video/playlist info
3. Each track: download → transcode → upload to Yoto
4. Card updated with new chapters

## External Dependencies

### Yoto API

- `@yotoplay/yoto-sdk` - Content and media operations
- `@yotoplay/oauth-device-code-flow` - Authentication

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
- [x] Feedback system (footer + feedback form + Resend email integration)
