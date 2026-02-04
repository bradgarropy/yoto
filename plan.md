# Yoto Sync - Implementation Plan

## Overview

A monorepo containing two packages for syncing YouTube content to Yoto:

- **yoto-cli**: Command-line tool for local syncing (uses yt-dlp)
- **yoto-web**: Local web UI for browser-based syncing (shares code with CLI)

Both packages use official Yoto packages for API interactions and authentication. The web app runs locally and reuses CLI logic for YouTube downloads and configuration.

---

## Tech Stack

| Component        | Technology                                                                  |
| ---------------- | --------------------------------------------------------------------------- |
| Monorepo         | npm workspaces                                                              |
| CLI              | TypeScript, Commander, @yotoplay/yoto-sdk, @yotoplay/oauth-device-code-flow |
| Web Framework    | React Router v7 (Framework Mode)                                            |
| Web Server       | Node.js (local only)                                                        |
| UI Components    | shadcn/ui + Tailwind                                                        |
| Auth             | @yotoplay/oauth-device-code-flow (shared with CLI)                          |
| YouTube Download | yt-dlp (shared with CLI)                                                    |
| State Storage    | JSON files in `~/.config/yoto/`                                             |

---

## Monorepo Structure

```
yoto/
├── package.json                      # Workspace root
├── plan.md                           # This file
├── packages/
│   ├── core/                         # Shared library (@yoto/core)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── auth.ts               # Token management, getYotoSdk()
│   │       ├── playlists.ts          # YouTube → Yoto card associations
│   │       ├── tracks.ts             # Synced track history per card
│   │       ├── paths.ts              # Shared config paths
│   │       ├── youtube.ts            # yt-dlp wrapper
│   │       ├── url.ts                # URL parsing utilities
│   │       └── *.test.ts             # Unit tests (48 total)
│   │
│   ├── cli/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # CLI entry (commander)
│   │       ├── ytdlp.ts              # Legacy download command
│   │       └── yoto/
│   │           └── sync.ts           # Sync YouTube → Yoto
│   │
│   └── web/                          # React Router + Node.js (local)
│       ├── package.json
│       ├── vite.config.ts
│       ├── react-router.config.ts
│       ├── app/
│       │   ├── root.tsx              # Layout with header navigation
│       │   ├── routes.ts             # Route definitions
│       │   ├── routes/
│       │   │   ├── home.tsx          # Dashboard (card grid)
│       │   │   ├── login.tsx         # Device code flow
│       │   │   ├── cards.$id.tsx     # Card detail (track list)
│       │   │   └── sync.tsx          # Sync form
│       │   ├── components/
│       │   │   └── ui/               # shadcn components
│       │   └── lib/
│       │       ├── auth.server.ts    # Auth helpers + re-exports
│       │       ├── sync.server.ts    # Sync logic (server-only)
│       │       └── tracks.server.ts  # tracks.json re-exports
│       └── server/
│           └── app.ts                # Node adapter entry
```

---

## Web App Routes

| Route        | Purpose               | Loader                     | Action                           |
| ------------ | --------------------- | -------------------------- | -------------------------------- |
| `/login`     | Device code auth flow | Check if authenticated     | Initiate device code, poll token |
| `/`          | Dashboard, list cards | Fetch cards from Yoto      | -                                |
| `/cards/:id` | Card detail           | Fetch card + synced tracks | -                                |
| `/sync`      | Sync form             | Fetch cards for dropdown   | Execute sync (blocking)          |

---

## CLI Commands

| Command                     | Description                             |
| --------------------------- | --------------------------------------- |
| `yoto login`                | Authenticate via Device Code Flow       |
| `yoto logout`               | Clear stored tokens                     |
| `yoto status`               | Show login status + token expiry        |
| `yoto list`                 | List all Yoto cards                     |
| `yoto sync <url> [-p name]` | Sync YouTube playlist/video to Yoto     |
| `yoto download <url>`       | Download YouTube audio locally (legacy) |

---

## Implementation Phases

### Phase 1: Monorepo Setup

- [x] Update root `package.json` with npm workspaces configuration:
    ```json
    {
        "workspaces": ["packages/*"]
    }
    ```
- [x] Create `packages/cli/` directory
- [x] Move existing `src/` files to `packages/cli/src/`
- [x] Create `packages/cli/package.json` with existing dependencies
- [x] Create `packages/cli/tsconfig.json`
- [x] Update import paths (replace `~/` alias or reconfigure)
- [x] Verify `npm install` at root works
- [x] Verify CLI still runs (`npm run dev -w packages/cli`)

---

### Phase 1.5: Testing & CI Setup

#### ESLint Setup

- [x] Install `eslint` and `@bradgarropy/eslint-config` in CLI package
- [x] Create `packages/cli/eslint.config.js`
- [x] Add `lint` script to CLI package

#### Prettier Setup

- [x] Install `prettier` at root
- [x] Add `format` and `format:fix` scripts to root package.json
- [x] Create `.prettierignore` to exclude `dist/` and `node_modules/`

#### Vitest Setup

- [x] Install `vitest` and `memfs` in CLI package
- [x] Create `packages/cli/vitest.config.ts` with `~` alias
- [x] Add `test`, `test:watch`, and `typecheck` scripts to CLI package

#### Unit Tests

- [x] Create `src/url.test.ts` - test URL parsing functions (9 tests)
- [x] Create `src/yoto/config.test.ts` - test config file operations using `memfs` (12 tests)
- [x] Create `src/yoto/auth.test.ts` - test auth logic by mocking config module (17 tests)

#### Root Scripts

- [x] Add `lint` script to root package.json
- [x] Add `test` script to root package.json
- [x] Add `format` script to root package.json
- [x] Add `typecheck` script to root package.json

#### GitHub Actions CI

- [x] Create `.github/workflows/ci.yml` (runs format, lint, typecheck, test)
- [x] Verify CI passes on push

---

### Phase 2: CLI Refactor

Replace custom Yoto API code with official packages.

#### Dependencies to Add

- [x] `@yotoplay/yoto-sdk`
- [x] `@yotoplay/oauth-device-code-flow`

#### Commands to Refactor

**login.ts**

- [x] Use `DeviceCodeAuth` from `@yotoplay/oauth-device-code-flow`
- [x] Initiate device code flow with `initiateDeviceCodeFlow()`
- [x] Display verification URL and user code to terminal
- [x] Poll for token with `pollForToken()`
- [x] Save tokens with `TokenManager`

**logout.ts**

- [x] Clear tokens using `TokenManager.clearTokens()`

**status.ts**

- [x] Check token validity with `TokenManager.areTokensValid()`
- [x] Display expiry information

**list.ts**

- [x] Use `yotoSdk.content.getMyCards()` instead of custom API

**sync.ts**

- [x] Use `yotoSdk.content.*` for card operations
- [x] Use `yotoSdk.media.*` for audio uploads
- [x] Keep existing yt-dlp YouTube download logic
- [x] Keep playlist association storage in `~/.config/yoto/`

#### Files to Remove

- [x] `src/yoto/api.ts` (replaced by SDK)
- [x] `src/yoto/auth.ts` (refactored, not removed - now uses OAuth package)

#### Files to Keep

- [x] `src/yoto/config.ts` (playlist associations only, auth removed)
- [x] `src/youtube.ts` (yt-dlp wrapper)
- [x] `src/ytdlp.ts` (legacy download)

#### Testing

- [x] Test `yoto login` - device code flow working
- [x] Test `yoto status` - shows token expiry
- [x] Test `yoto list` - shows cards via SDK
- [x] Test `yoto sync` - full sync flow working
- [x] Test `yoto logout` - clears tokens

#### Notes

- Created Public Client in Yoto developer dashboard (client ID: `PhKouPhz6NPVaWLtyeiEwjfB7m8sVR77`)
- SDK types don't match actual API responses in some places, required type assertions
- Auth tokens stored in `~/.config/yoto/auth.json` via `TokenManager`

---

### Phase 3: Local Web App

#### Initialize Project

- [x] Create `packages/web/` with React Router v7 + Node adapter
- [x] Configure Vite for the web package (port 3000)
- [x] Add to workspace (already included via `packages/*` glob)
- [x] Verify dev server runs: `npm run dev -w packages/web`

#### Set Up UI

- [x] Install and configure Tailwind CSS v4
- [x] Initialize shadcn/ui
- [x] Install base components (button, input, card, select, label)

#### Core Package (packages/core)

- [x] Create `@yoto/core` package with shared functionality
- [x] Add exports for auth, playlists, tracks, paths, youtube, url modules
- [x] Add `tracks.json` support (ordered array structure for track history)
- [x] Verify web can import from `@yoto/core` package

#### Auth (app/lib/auth.server.ts)

- [x] Read tokens from shared `~/.config/yoto/auth.json`
- [x] Token refresh logic (via `@yoto/core/auth`)
- [x] Helper to get authenticated Yoto SDK instance (`getAuthenticatedSdk`)
- [x] Auth middleware to protect routes (`requireAuth` - redirects to `/login`)

#### Login Route (app/routes/login.tsx)

- [x] Loader: Check if already authenticated, redirect to `/` if so
- [x] Action: Handle device code flow
    - Initiate device code flow
    - Poll for token completion
    - Save tokens to shared config
- [x] Component:
    - Display "Go to [URL] and enter code [CODE]" instructions
    - Loading state while polling
    - Redirect to `/` on success

#### Dashboard Route (app/routes/home.tsx)

- [x] Loader: Fetch cards via Yoto SDK (show login prompt if unauthenticated)
- [x] Component:
    - Display card grid with names
    - Link to card detail
    - "Sync" button linking to `/sync`

#### Card Detail Route (app/routes/cards.$id.tsx)

- [x] Loader: Require auth, fetch card from SDK + synced tracks from `tracks.json`
- [x] Component:
    - Display card info (title, track count)
    - List all tracks on card with durations
    - Indicate which tracks came from YouTube syncs (via `tracks.json`)
    - Link to sync more content

#### Sync Route (app/routes/sync.tsx)

- [x] Loader: Require auth, fetch cards for dropdown
- [x] Action (blocking execution):
    - Parse YouTube URL (detect video vs playlist)
    - If "Create New" selected, create card via SDK
    - Check `tracks.json` for already-synced videos
    - Download new videos via yt-dlp (from `@yoto/core/youtube`)
    - Upload to Yoto via SDK
    - Update `tracks.json` with new tracks (preserving order)
    - Return results
- [x] Component:
    - YouTube URL input field
    - Card selector dropdown with "Create New Card" option
    - New card name input (shown when "Create New" selected)
    - Submit button
    - Loading state during sync
    - Results: "Added X tracks, skipped Y (already synced)"

#### Polish

- [x] Error handling with user-friendly messages
- [x] Loading states using React Router fetchers
- [x] Basic responsive layout
- [x] Navigation between routes (header with Cards/Sync links)

#### Testing (Manual)

- [x] Login via device code flow (redirects if already logged in)
- [x] View cards on dashboard (8 cards displayed)
- [x] View card detail with track list (23 tracks with durations on "Discover")
- [x] Sync single video to new card ("Me at the zoo" → "Test Card - Delete Me")
- [x] Sync playlist to existing card
- [x] Sync playlist to new card
- [x] Verify "skip existing" works (re-sync same playlist)

#### Unit Tests

- [x] Web package has 17 tests (stripNullValues, createChapter helpers)
- [x] Core package has 48 tests (auth, playlists, tracks, url modules)

#### Notes

- Fixed Node.js module bundling issue: moved `node:fs`, `node:crypto` imports to `.server.ts` files
- Fixed single video URL support: added `isPlaylistUrl()`, `extractVideoId()`, `getVideoInfo()` to `@yoto/core/youtube`
- Server-only re-exports in `app/lib/*.server.ts` prevent client bundling of Node.js modules
- Fixed tracks.json recording: moved `addSyncedTrack()` calls to AFTER card update succeeds (was recording before confirming update)
- Fixed 400 error on playlist sync: Yoto API rejects `null` values in chapter fields (`display`, `ambient`, etc.) - added `stripNullValues()` helper to remove nulls before sending updates

---

### Phase 4: Polish

#### UI Enhancements

- [x] Show card cover art on the home page
- [x] Show card track count on the home page
- [x] Show card cover art on the /cards/:cardId page
- [ ] Add delete track functionality to the /cards/:cardId page
- [ ] Add reorder capability to tracks on the /cards/:cardId page
- [ ] Make the destination card select a combobox on the /sync page

---

## Risks & Mitigations

### yt-dlp Availability

**Risk**: yt-dlp must be installed on the local machine.

**Mitigation**:

- Document installation instructions for macOS/Linux/Windows
- Consider bundling yt-dlp binary or using npm package wrapper
- CLI already validates yt-dlp is available before sync

### Token Expiry During Long Syncs

**Risk**: Auth tokens expire mid-sync for large playlists.

**Mitigation**:

- Refresh tokens before starting sync if close to expiry
- Handle 401 errors gracefully with re-auth prompt

---

## Future Enhancements (Post-v1)

- [ ] yotoicons.com integration (pending API availability or decision to scrape)
- [ ] Cloud hosting (Cloudflare Workers) for remote/mobile access
- [ ] Browser extension for YouTube
- [ ] Batch sync (multiple playlists at once)
- [ ] Sync history and retry failed jobs
- [ ] Card cover image customization
- [ ] Default icons for new tracks

---

## External Dependencies

### Official Yoto Packages

- `@yotoplay/yoto-sdk` - API client for Yoto
- `@yotoplay/oauth-device-code-flow` - Auth0 Device Code Flow

### Yoto Auth0 Configuration

- Domain: `login.yotoplay.com`
- Client ID: `90v6OFRB0bKTtpSCqT7edO7rlu9je8nb`
- Audience: `https://api.yotoplay.com`
- Token lifetime: ~24 hours

### Local Dependencies

- Node.js (v20+)
- yt-dlp (installed via Homebrew or package manager)

---

## Config Files Reference

### CLI Config (~/.config/yoto/)

**auth.json** (managed by TokenManager)

```json
{
    "accessToken": "eyJhbG...",
    "refreshToken": "...",
    "expiresAt": 1769830490,
    "tokenType": "Bearer"
}
```

**playlists.json** (YouTube → Yoto associations)

```json
{
    "PLxxxxx": {
        "yotoId": "abc123",
        "yotoName": "Discover",
        "youtubeName": "Discover Playlist",
        "lastSynced": "2026-01-24T23:30:00Z"
    }
}
```

**tracks.json** (synced tracks per card, ordered)

```json
{
    "cardId123": {
        "videos": [
            {
                "youtubeVideoId": "videoIdABC",
                "title": "First Song",
                "syncedAt": "2026-02-03T12:00:00Z",
                "yotoTrackKey": "track-key-from-yoto"
            },
            {
                "youtubeVideoId": "videoIdDEF",
                "title": "Second Song",
                "syncedAt": "2026-02-03T12:01:00Z",
                "yotoTrackKey": "another-track-key"
            }
        ],
        "youtubePlaylistId": "PLxxxxx",
        "lastSynced": "2026-02-03T12:01:00Z"
    }
}
```

---

## Reference: Yoto SDK Usage

```typescript
import {createYotoSdk} from "@yotoplay/yoto-sdk"

// Create SDK instance with JWT
const sdk = createYotoSdk({jwt: accessToken})

// List cards
const cards = await sdk.content.getMyCards()

// Get card details
const card = await sdk.content.getCard(cardId)

// Update card
await sdk.content.updateCard(cardData)

// Upload audio
const uploadUrl = await sdk.media.getUploadUrlForTranscode(sha256, filename)
await sdk.media.uploadFile(uploadUrl.url, audioBuffer)
const transcoded = await sdk.media.getTranscodedUpload(uploadId, true)
```

---

## Reference: Device Code Flow Usage

```typescript
import {DeviceCodeAuth, TokenManager} from "@yotoplay/oauth-device-code-flow"

const auth = new DeviceCodeAuth({
    domain: "login.yotoplay.com",
    clientId: "90v6OFRB0bKTtpSCqT7edO7rlu9je8nb",
    audience: "https://api.yotoplay.com",
})

const tokenManager = new TokenManager("./tokens.json")

// Start device code flow
const deviceCode = await auth.initiateDeviceCodeFlow()
console.log("Go to:", deviceCode.verificationUri)
console.log("Enter code:", deviceCode.userCode)

// Poll for token
const result = await auth.pollForToken(
    deviceCode.deviceCode,
    deviceCode.interval,
    300000, // 5 min timeout
)

// Save tokens
await tokenManager.saveTokens(result.tokens)

// Later: refresh if needed
const refreshed = await auth.refreshToken(storedTokens.refreshToken)
```
