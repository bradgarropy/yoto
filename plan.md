# Yoto CLI - YouTube to Yoto Sync

## Overview

Sync YouTube playlists to Yoto with a single command. Downloads songs from YouTube, uploads them to Yoto, and creates/updates playlists with smart merge logic.

## Commands

| Command                     | Description                               |
| --------------------------- | ----------------------------------------- |
| `yoto login`                | Paste and store auth token                |
| `yoto logout`               | Clear stored token                        |
| `yoto status`               | Show login status + token expiry          |
| `yoto list`                 | Show all Yoto playlists (table: ID, Name) |
| `yoto sync <url> [-p name]` | Sync YouTube playlist to Yoto             |

## Dependencies to Add

```bash
npm install @inquirer/prompts fuse.js
```

- `@inquirer/prompts` - Prompts, confirmations, selections
- `fuse.js` - Fuzzy matching for playlists and tracks

## File Structure

```
src/
├── index.ts              # CLI entry point with subcommands
├── ytdlp.ts              # yt-dlp wrapper (existing)
├── url.ts                # URL helpers (existing)
└── yoto/
    ├── auth.ts           # Token storage, validation, login/logout
    ├── api.ts            # Yoto API client
    ├── config.ts         # Config paths + playlist associations
    └── sync.ts           # Sync orchestration logic
```

## Config Files

```
~/.config/yoto/
├── auth.json             # { accessToken, expiresAt }
└── playlists.json        # YouTube → Yoto associations
```

### auth.json

```json
{
    "accessToken": "eyJhbG...",
    "expiresAt": 1769359129
}
```

### playlists.json

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

## Command Details

### `yoto login`

```
$ yoto login

To authenticate with Yoto:

1. Open https://my.yotoplay.com in your browser
2. Log in if needed
3. Open DevTools (F12) → Network tab
4. Refresh the page
5. Click any request to api.yotoplay.com
6. Copy the "authorization" header value (starts with "Bearer ey...")

? Paste your token: Bearer eyJhbG...

✓ Logged in successfully! Token expires in 23 hours.
```

### `yoto logout`

```
$ yoto logout
✓ Logged out. Token cleared.
```

### `yoto status`

```
$ yoto status
✓ Logged in
  Token expires in 22 hours
```

### `yoto list`

```
$ yoto list

ID       Name
───────  ─────────────────────────────────────
1njmh    Sing
gzRwX    Discover
5jbdI    Wall-e
eKNPy    Bad Guys 2
sZ0vC    Harry Potter and the Sorcerer's Stone
bT1tt    Sofi's Playlist
g76SZ    Justin's Playlist

7 playlists
```

### `yoto sync`

```
$ yoto sync "https://youtube.com/playlist?list=PLxxxxx"

Fetching YouTube playlist...
Found: "Road Trip Vibes" (6 songs)

Found linked Yoto playlist: "Road Trip" (abc123)
Fetching current tracks...

Sync plan:

  #   Status   Track
  ──────────────────────────────────────
  1   ✓        Sweet Home Alabama
  2   +        Take It Easy
  3   ✓        Hotel California
  4   +        Free Bird
  5   +        Ramblin' Man
  -   -        Old Song

  Summary: 2 keep, 3 add, 1 remove

? Continue with sync? (y/n) y

Downloading new songs...
[1/3] Take It Easy ✓
[2/3] Free Bird ✓
[3/3] Ramblin' Man ✓

Uploading to Yoto...
[1/3] Take It Easy ✓
[2/3] Free Bird ✓
[3/3] Ramblin' Man ✓

Updating playlist...
✓ Playlist updated!
  Opening https://my.yotoplay.com/card/abc123/edit
```

#### Status Legend

- `✓` = kept (existing track preserved with its icon)
- `+` = added (new track with number icon)
- `-` = removed

#### Options

| Flag                    | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `-p, --playlist <name>` | Fuzzy match Yoto playlist by name (e.g., "Discover") |

#### Sync Resolution Order

1. If `--playlist` provided → fuzzy find Yoto playlist by name
2. Else if saved association exists → use linked Yoto playlist
3. Else → prompt for new playlist name

#### Fuzzy Matching

When `--playlist` matches multiple playlists, show selection:

```
$ yoto sync "https://youtube.com/playlist?list=PLxxxxx" --playlist "kid"

Multiple Yoto playlists match "kid":
? Select a playlist:
❯ Kids Music (abc123)
  Kids Stories (def456)
```

## Smart Merge Strategy

For each track in YouTube playlist (preserves YouTube order):

1. **Fuzzy match** track title against existing Yoto playlist tracks
2. **If match found**: Keep existing Yoto track (preserves icon, metadata)
3. **If no match**: Download from YouTube, upload to Yoto, assign number icon based on position

Tracks in Yoto but **not** in YouTube → **Removed** (with confirmation)

### Example

**YouTube Playlist (source of truth for order):**

1. Sweet Home Alabama
2. Take It Easy _(new)_
3. Hotel California
4. Free Bird _(new)_

**Existing Yoto Playlist:**

1. Hotel California (custom star icon)
2. Sweet Home Alabama (custom guitar icon)
3. Old Song (will be removed)

**Result after sync:**

1. Sweet Home Alabama (keeps guitar icon)
2. Take It Easy (new, gets "2" number icon)
3. Hotel California (keeps star icon)
4. Free Bird (new, gets "4" number icon)

## Key Behaviors

| Scenario                        | Behavior                                       |
| ------------------------------- | ---------------------------------------------- |
| `--playlist` matches multiple   | Show selection list via inquirer               |
| `--playlist` matches none       | Prompt for new playlist name                   |
| Saved association exists        | Use it, ask for confirmation                   |
| No association, no `--playlist` | Prompt for new playlist name, save association |
| Tracks will be removed          | Show in sync plan table, ask for confirmation  |
| Song fails to download          | Abort entire sync, clean up temp dir           |
| Any error                       | Always clean up temp directory                 |
| Sync complete                   | Open Yoto playlist in browser                  |

## Yoto API Reference

### Base URL

`https://api.yotoplay.com`

### Authentication

Bearer token in `Authorization` header:

```
Authorization: Bearer eyJhbG...
```

### Endpoints

#### List playlists

```
GET /content/mine
```

#### Get playlist

```
GET /content/{cardId}
```

#### Create playlist

```
POST /content
Content-Type: application/json

{
  "title": "Playlist Name",
  "content": {
    "activity": "yoto_Player",
    "chapters": [...],
    "restricted": true,
    "config": {"onlineOnly": false},
    "version": "1"
  },
  "metadata": {
    "cover": {"imageL": "https://cdn.yoto.io/myo-cover/bee_grapefruit.gif"},
    "media": {...}
  }
}
```

#### Update playlist

```
PUT /content/{cardId}
```

#### Get upload URL

```
GET /media/transcode/audio/uploadUrl?sha256={sha256}&filename={filename}
```

#### Check transcode status

```
GET /media/upload/{sha256}/transcoded?loudnorm=false
```

## Implementation Order

| Step | File                 | Description                                         |
| ---- | -------------------- | --------------------------------------------------- |
| 1    | `src/yoto/config.ts` | Config paths, read/write auth.json & playlists.json |
| 2    | `src/yoto/auth.ts`   | login, logout, status, getToken() helper            |
| 3    | `src/yoto/api.ts`    | Yoto API client (list, get, create, update, upload) |
| 4    | `src/yoto/sync.ts`   | Sync orchestration with smart merge logic           |
| 5    | `src/index.ts`       | Wire up all subcommands                             |
