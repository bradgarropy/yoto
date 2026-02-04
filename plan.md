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
│   ├── cli/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # CLI entry (commander)
│   │       ├── commands/
│   │       │   ├── login.ts          # Device code flow auth
│   │       │   ├── logout.ts
│   │       │   ├── status.ts
│   │       │   ├── list.ts           # List Yoto cards
│   │       │   ├── sync.ts           # Sync YouTube → Yoto
│   │       │   └── download.ts       # Download only (legacy)
│   │       ├── youtube.ts            # yt-dlp wrapper (existing)
│   │       └── config.ts             # Local storage (playlist associations)
│   │
│   └── web/                          # React Router + Node.js (local)
│       ├── package.json
│       ├── vite.config.ts
│       ├── react-router.config.ts
│       ├── app/
│       │   ├── root.tsx
│       │   ├── routes.ts
│       │   ├── routes/
│       │   │   ├── _index.tsx        # Dashboard
│       │   │   ├── login.tsx         # Device code flow
│       │   │   ├── cards.$id.tsx     # Card detail
│       │   │   └── sync.tsx          # Sync form
│       │   ├── components/
│       │   │   └── ui/               # shadcn components
│       │   └── lib/
│       │       ├── auth.server.ts    # Read/refresh tokens from CLI config
│       │       ├── yoto.server.ts    # SDK wrapper
│       │       ├── youtube.server.ts # Import yt-dlp wrapper from CLI
│       │       └── tracks.server.ts  # tracks.json read/write
│       └── server.ts                 # Node adapter entry
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

- [ ] Create `packages/web/` with React Router v7 + Node adapter
- [ ] Configure Vite for the web package
- [ ] Add to workspace (already included via `packages/*` glob)
- [ ] Verify dev server runs: `npm run dev -w packages/web`

#### Set Up UI

- [ ] Install and configure Tailwind CSS
- [ ] Initialize shadcn/ui
- [ ] Install base components (button, input, card, select, etc.)

#### CLI Package Exports

- [ ] Add `exports` field to `packages/cli/package.json`:
    - `youtube.ts` (yt-dlp wrapper)
    - `config.ts` (config read/write)
    - `yoto/auth.ts` (token management)
- [ ] Add `tracks.json` support to CLI config module (ordered array structure)
- [ ] Verify web can import from CLI package

#### Auth (app/lib/auth.server.ts)

- [ ] Read tokens from shared `~/.config/yoto/auth.json`
- [ ] Token refresh logic (call SDK refresh if expired)
- [ ] Helper to get authenticated Yoto SDK instance
- [ ] Auth middleware to protect routes (redirect to `/login` if unauthenticated)

#### Login Route (app/routes/login.tsx)

- [ ] Loader: Check if already authenticated, redirect to `/` if so
- [ ] Action: Handle device code flow
    - Initiate device code flow
    - Poll for token completion
    - Save tokens to shared config
- [ ] Component:
    - Display "Go to [URL] and enter code [CODE]" instructions
    - Loading state while polling
    - Redirect to `/` on success

#### Dashboard Route (app/routes/\_index.tsx)

- [ ] Loader: Require auth, fetch cards via Yoto SDK
- [ ] Component:
    - Display card grid with names/cover images
    - Show track count per card
    - Link to card detail
    - "Sync" button linking to `/sync`

#### Card Detail Route (app/routes/cards.$id.tsx)

- [ ] Loader: Require auth, fetch card from SDK + synced tracks from `tracks.json`
- [ ] Component:
    - Display card info (title, cover)
    - List all tracks on card
    - Indicate which tracks came from YouTube syncs (via `tracks.json`)

#### Sync Route (app/routes/sync.tsx)

- [ ] Loader: Require auth, fetch cards for dropdown
- [ ] Action (blocking execution):
    - Parse YouTube URL (detect video vs playlist)
    - If "Create New" selected, create card via SDK
    - Check `tracks.json` for already-synced videos
    - Download new videos via yt-dlp (imported from CLI)
    - Upload to Yoto via SDK
    - Update `tracks.json` with new tracks (preserving order)
    - Return results
- [ ] Component:
    - YouTube URL input field
    - Card selector dropdown with "Create New Card" option
    - New card name input (shown when "Create New" selected)
    - Submit button
    - Loading state during sync
    - Results: "Added X tracks, skipped Y (already synced)"

#### Polish

- [ ] Error handling with user-friendly messages
- [ ] Loading states using React Router `useNavigation`
- [ ] Basic responsive layout
- [ ] Navigation between routes

#### Testing

- [ ] Login via device code flow
- [ ] View cards on dashboard
- [ ] View card detail with track list
- [ ] Sync single video to existing card
- [ ] Sync playlist to existing card
- [ ] Sync to new card (create card flow)
- [ ] Verify "skip existing" works (re-sync same playlist)

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
