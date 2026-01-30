# Yoto Sync - Implementation Plan

## Overview

A monorepo containing two packages for syncing YouTube content to Yoto:

- **yoto-cli**: Command-line tool for local syncing (uses yt-dlp)
- **yoto-web**: Web application for browser-based syncing (Cloudflare Workers)

Both packages use official Yoto packages for API interactions and authentication.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Monorepo | npm workspaces |
| CLI | TypeScript, Commander, @yotoplay/yoto-sdk, @yotoplay/oauth-device-code-flow |
| Web Framework | React Router v7 (Framework Mode) |
| Web Hosting | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| ORM | Drizzle ORM + drizzle-kit |
| UI Components | shadcn/ui + Tailwind |
| Auth | @yotoplay/oauth-device-code-flow (Device Code Flow) |
| YouTube Download (CLI) | yt-dlp |
| YouTube Download (Web) | ytdl-core (initially), Containers (fallback) |
| Async Jobs | Cloudflare Queues |
| Temp Storage | Cloudflare R2 |

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
│   └── web/                          # React Router + Cloudflare Workers
│       ├── package.json
│       ├── vite.config.ts
│       ├── react-router.config.ts
│       ├── wrangler.jsonc            # D1, R2, Queues bindings
│       ├── drizzle.config.ts
│       ├── workers/
│       │   └── app.ts                # Worker entry
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
│       │       ├── db.server.ts      # Drizzle client
│       │       ├── auth.server.ts    # Auth helpers
│       │       └── youtube.server.ts # ytdl-core
│       └── drizzle/
│           ├── schema.ts
│           └── migrations/
```

---

## D1 Database Schema (Drizzle)

```typescript
// drizzle/schema.ts
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),                    // Yoto user ID (from JWT sub)
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').default(sql`(unixepoch())`),
});

export const tracks = sqliteTable('tracks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.id),
  youtubeVideoId: text('youtube_video_id').notNull(),
  yotoCardId: text('yoto_card_id').notNull(),
  yotoTrackKey: text('yoto_track_key').notNull(),
  title: text('title'),
  createdAt: integer('created_at').default(sql`(unixepoch())`),
}, (table) => ({
  uniqueTrack: uniqueIndex('unique_track').on(
    table.userId, 
    table.youtubeVideoId, 
    table.yotoCardId
  ),
}));

export const syncJobs = sqliteTable('sync_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.id),
  youtubeUrl: text('youtube_url').notNull(),
  yotoCardId: text('yoto_card_id').notNull(),
  status: text('status').default('pending'),      // pending, processing, completed, failed
  tracksAdded: integer('tracks_added').default(0),
  tracksSkipped: integer('tracks_skipped').default(0),
  error: text('error'),
  createdAt: integer('created_at').default(sql`(unixepoch())`),
  completedAt: integer('completed_at'),
});
```

---

## Web App Routes

| Route | Purpose | Loader | Action |
|-------|---------|--------|--------|
| `/login` | Device code auth flow | Check if authenticated | Initiate device code |
| `/logout` | Clear session | - | Delete tokens |
| `/` | Dashboard, list cards | Fetch cards from Yoto | - |
| `/cards/:id` | Card detail | Fetch card + tracks | - |
| `/sync` | Sync form | Fetch cards for dropdown | Create sync job |

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `yoto login` | Authenticate via Device Code Flow |
| `yoto logout` | Clear stored tokens |
| `yoto status` | Show login status + token expiry |
| `yoto list` | List all Yoto cards |
| `yoto sync <url> [-p name]` | Sync YouTube playlist/video to Yoto |
| `yoto download <url>` | Download YouTube audio locally (legacy) |

---

## Implementation Phases

### Phase 1: Monorepo Setup

- [ ] Update root `package.json` with npm workspaces configuration:
  ```json
  {
    "workspaces": ["packages/*"]
  }
  ```
- [ ] Create `packages/cli/` directory
- [ ] Move existing `src/` files to `packages/cli/src/`
- [ ] Create `packages/cli/package.json` with existing dependencies
- [ ] Create `packages/cli/tsconfig.json`
- [ ] Update import paths (replace `~/` alias or reconfigure)
- [ ] Verify `npm install` at root works
- [ ] Verify CLI still runs (`npm run dev -w packages/cli`)

---

### Phase 2: CLI Refactor

Replace custom Yoto API code with official packages.

#### Dependencies to Add
- [ ] `@yotoplay/yoto-sdk`
- [ ] `@yotoplay/oauth-device-code-flow`

#### Commands to Refactor

**login.ts**
- [ ] Use `DeviceCodeAuth` from `@yotoplay/oauth-device-code-flow`
- [ ] Initiate device code flow with `initiateDeviceCodeFlow()`
- [ ] Display verification URL and user code to terminal
- [ ] Poll for token with `pollForToken()`
- [ ] Save tokens with `TokenManager`

**logout.ts**
- [ ] Clear tokens using `TokenManager.clearTokens()`

**status.ts**
- [ ] Check token validity with `TokenManager.areTokensValid()`
- [ ] Display expiry information

**list.ts**
- [ ] Use `yotoSdk.content.getMyCards()` instead of custom API

**sync.ts**
- [ ] Use `yotoSdk.content.*` for card operations
- [ ] Use `yotoSdk.media.*` for audio uploads
- [ ] Keep existing yt-dlp YouTube download logic
- [ ] Keep playlist association storage in `~/.config/yoto/`

#### Files to Remove
- [ ] `src/yoto/api.ts` (replaced by SDK)
- [ ] `src/yoto/auth.ts` (replaced by Device Code Flow package)

#### Files to Keep
- [ ] `src/yoto/config.ts` (playlist associations)
- [ ] `src/youtube.ts` (yt-dlp wrapper)
- [ ] `src/ytdlp.ts` (legacy download)

#### Testing
- [ ] Test `yoto login` - should open browser prompt
- [ ] Test `yoto status` - should show token expiry
- [ ] Test `yoto list` - should show cards
- [ ] Test `yoto sync` - full sync flow
- [ ] Test `yoto logout` - should clear tokens

---

### Phase 3: Web App Setup

#### Initialize Project
- [ ] Create web app using Cloudflare template:
  ```bash
  npm create cloudflare@latest -- packages/web --framework=react-router
  ```
- [ ] Or manually set up React Router v7 + Cloudflare Vite plugin
- [ ] Add to workspace in root `package.json`

#### Configure Cloudflare Bindings (wrangler.jsonc)
- [ ] D1 database binding
- [ ] R2 bucket binding (for temporary audio storage)
- [ ] Queue producer binding
- [ ] Queue consumer configuration

#### Set Up Drizzle ORM
- [ ] Install `drizzle-orm` and `drizzle-kit`
- [ ] Create `drizzle.config.ts`
- [ ] Create schema in `drizzle/schema.ts`
- [ ] Generate initial migration
- [ ] Apply migration to D1

#### Set Up UI
- [ ] Install and configure Tailwind CSS
- [ ] Initialize shadcn/ui
- [ ] Install base components (button, input, card, select, etc.)

#### Verify Setup
- [ ] Run dev server: `npm run dev -w packages/web`
- [ ] Verify Cloudflare bindings available in loaders/actions

---

### Phase 4: Web Auth Implementation

#### Auth Utilities (app/lib/auth.server.ts)
- [ ] Session management using cookies
- [ ] Token storage/retrieval from D1 `users` table
- [ ] Token refresh logic using `@yotoplay/oauth-device-code-flow`
- [ ] Helper to get authenticated Yoto SDK instance

#### Login Route (app/routes/login.tsx)
- [ ] Loader: Check if already authenticated, redirect to `/` if so
- [ ] Action: Handle device code flow initiation
  - Call `DeviceCodeAuth.initiateDeviceCodeFlow()`
  - Return verification URL and user code
- [ ] Component:
  - Display "Go to [URL] and enter code [CODE]" instructions
  - Show QR code (optional)
  - Client-side polling for token completion
  - Redirect to `/` on success

#### Logout Route (app/routes/logout.tsx)
- [ ] Action: Clear session cookie, delete tokens from D1
- [ ] Redirect to `/login`

#### Auth Protection
- [ ] Create helper to require auth in loaders
- [ ] Redirect to `/login` if not authenticated

---

### Phase 5: Web Dashboard & Cards

#### Dashboard Route (app/routes/_index.tsx)
- [ ] Loader:
  - Require authentication
  - Fetch cards via `yotoSdk.content.getMyCards()`
  - Return cards list
- [ ] Component:
  - Display card grid/list
  - Show card name, track count
  - Link to card detail
  - "Sync New" button linking to `/sync`

#### Card Detail Route (app/routes/cards.$id.tsx)
- [ ] Loader:
  - Require authentication
  - Fetch card details via `yotoSdk.content.getCard(params.id)`
  - Fetch track mappings from D1 `tracks` table
  - Return card + tracks
- [ ] Component:
  - Display card info (title, cover)
  - List tracks with YouTube video IDs
  - Show which tracks were synced from YouTube vs manually added

#### UI Components
- [ ] Card list component
- [ ] Card detail component
- [ ] Navigation/layout with auth state

---

### Phase 6: Web Sync Feature

#### Sync Route (app/routes/sync.tsx)
- [ ] Loader:
  - Require authentication
  - Fetch cards for dropdown selector
- [ ] Action:
  - Validate YouTube URL
  - Create sync job in D1 `sync_jobs` table
  - Add job to Cloudflare Queue
  - Return job ID
- [ ] Component:
  - URL input field (single video or playlist)
  - Card selector dropdown (or "Create New" option)
  - Submit button
  - After submit: show job status, poll for completion

#### YouTube Download (app/lib/youtube.server.ts)
- [ ] Install `@distube/ytdl-core` or similar
- [ ] Implement `getVideoInfo(url)` - extract metadata
- [ ] Implement `getPlaylistInfo(url)` - extract all video IDs and titles
- [ ] Implement `downloadAudio(videoId)` - download to R2
- [ ] Handle errors (unavailable videos, age-restricted, etc.)

#### Queue Consumer (workers/app.ts)
- [ ] Add queue consumer export alongside React Router handler
- [ ] Process sync jobs:
  1. Get job from D1
  2. Update status to "processing"
  3. Fetch YouTube video/playlist info
  4. For each video:
     - Check if already synced (D1 `tracks` table)
     - If exists, skip
     - If new, download audio to R2
     - Upload to Yoto via SDK
     - Add track mapping to D1
  5. Update Yoto card with new tracks
  6. Update job status to "completed"
  7. Clean up R2 files
- [ ] Handle errors, update job with error message

#### Progress Display
- [ ] Poll job status endpoint from client
- [ ] Show progress: "Processing track 3 of 10"
- [ ] Show results: "Added 5 tracks, skipped 3 (already existed)"

---

### Phase 7: Polish & Deploy

#### Error Handling
- [ ] Add error boundaries to routes
- [ ] User-friendly error messages
- [ ] Retry logic for transient failures

#### UX Polish
- [ ] Loading states using React Router `useNavigation`
- [ ] Form validation with helpful messages
- [ ] Success/error toasts or notifications
- [ ] Responsive design for various screen sizes

#### Cloudflare Setup
- [ ] Create D1 database in Cloudflare dashboard
- [ ] Create R2 bucket for temporary audio storage
- [ ] Create Queue for sync jobs
- [ ] Set up R2 lifecycle rules to auto-delete old files (optional)

#### Deployment
- [ ] Configure production wrangler settings
- [ ] Deploy with `npm run deploy -w packages/web`
- [ ] Verify all bindings work in production

#### Testing
- [ ] End-to-end: Login → View Cards → Sync → Verify tracks added
- [ ] Test playlist sync (multiple videos)
- [ ] Test single video sync
- [ ] Test "skip existing" logic
- [ ] Test error cases (invalid URL, unavailable video)

---

## Risks & Mitigations

### ytdl-core Reliability
**Risk**: YouTube frequently changes their systems, breaking ytdl-core.

**Mitigation**: 
- Start with `@distube/ytdl-core` (more actively maintained)
- If unreliable, migrate to Cloudflare Containers running yt-dlp
- Keep CLI as fallback (uses yt-dlp directly)

### Worker Execution Time Limits
**Risk**: Long syncs (many videos) may exceed Worker time limits (~30s paid tier).

**Mitigation**:
- Use Queues to process jobs asynchronously
- Process one video at a time within queue handler
- If still hitting limits, use Cloudflare Containers

### R2 Storage Cleanup
**Risk**: Temporary audio files accumulate in R2.

**Mitigation**:
- Delete files immediately after Yoto upload
- Set R2 lifecycle rules to auto-delete files older than 24 hours
- Add cleanup job if needed

---

## Future Enhancements (Post-v1)

- [ ] yotoicons.com integration (pending API availability or decision to scrape)
- [ ] Mobile support (revisit phone-based workflow)
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

### Cloudflare Services
- Workers - Compute
- D1 - SQLite database
- R2 - Object storage
- Queues - Async job processing

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

---

## Reference: Yoto SDK Usage

```typescript
import { createYotoSdk } from '@yotoplay/yoto-sdk';

// Create SDK instance with JWT
const sdk = createYotoSdk({ jwt: accessToken });

// List cards
const cards = await sdk.content.getMyCards();

// Get card details
const card = await sdk.content.getCard(cardId);

// Update card
await sdk.content.updateCard(cardData);

// Upload audio
const uploadUrl = await sdk.media.getUploadUrlForTranscode(sha256, filename);
await sdk.media.uploadFile(uploadUrl.url, audioBuffer);
const transcoded = await sdk.media.getTranscodedUpload(uploadId, true);
```

---

## Reference: Device Code Flow Usage

```typescript
import { DeviceCodeAuth, TokenManager } from '@yotoplay/oauth-device-code-flow';

const auth = new DeviceCodeAuth({
  domain: 'login.yotoplay.com',
  clientId: '90v6OFRB0bKTtpSCqT7edO7rlu9je8nb',
  audience: 'https://api.yotoplay.com'
});

const tokenManager = new TokenManager('./tokens.json');

// Start device code flow
const deviceCode = await auth.initiateDeviceCodeFlow();
console.log('Go to:', deviceCode.verificationUri);
console.log('Enter code:', deviceCode.userCode);

// Poll for token
const result = await auth.pollForToken(
  deviceCode.deviceCode,
  deviceCode.interval,
  300000 // 5 min timeout
);

// Save tokens
await tokenManager.saveTokens(result.tokens);

// Later: refresh if needed
const refreshed = await auth.refreshToken(storedTokens.refreshToken);
```
