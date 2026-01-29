# Yoto CLI

Sync YouTube playlists to Yoto with a single command. Downloads songs from YouTube, uploads them to Yoto, and creates/updates playlists with smart merge logic.

## Prerequisites

- Node.js 18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://www.ffmpeg.org/) installed

```bash
brew install yt-dlp ffmpeg
```

## Installation

```bash
npm install
npm run build
npm link
```

## Commands

### `yoto login`

Authenticate with Yoto by pasting a bearer token from the web app.

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

Logged in successfully! Token expires in 23 hours.
```

### `yoto logout`

Clear stored authentication token.

```
$ yoto logout
Logged out. Token cleared.
```

### `yoto status`

Show login status and token expiry.

```
$ yoto status
Logged in
  Token expires in 22 hours
```

### `yoto list`

Show all Yoto playlists.

```
$ yoto list

ID       Name
───────  ─────────────────────────────────────
1njmh    Sing
gzRwX    Discover
5jbdI    Wall-e

3 playlists
```

### `yoto sync <url> [options]`

Sync a YouTube playlist to Yoto.

```
$ yoto sync "https://youtube.com/playlist?list=PLxxxxx"

Fetching YouTube playlist...
Found: "Road Trip Vibes" (6 songs)

? Select a Yoto playlist or create new: Create new playlist
? Enter playlist name: Road Trip Vibes

Sync plan:

  #   Status   Track
  ──────────────────────────────────────
   1   +        Sweet Home Alabama
   2   +        Take It Easy
   3   +        Hotel California

  Summary: 0 keep, 3 add, 0 remove

? Continue with sync? Yes

Downloading new songs...
[1/3] Sweet Home Alabama... done
[2/3] Take It Easy... done
[3/3] Hotel California... done

Uploading to Yoto...
[1/3] Sweet Home Alabama... done
[2/3] Take It Easy... done
[3/3] Hotel California... done

Updating playlist...
Playlist updated!
  Opening https://my.yotoplay.com/card/abc123/edit
```

#### Options

| Flag | Description |
|------|-------------|
| `-p, --playlist <name>` | Fuzzy match Yoto playlist by name |

#### Examples

```bash
# Sync to a new or selected playlist
yoto sync "https://youtube.com/playlist?list=PLxxxxx"

# Sync to a specific playlist by name (fuzzy matched)
yoto sync "https://youtube.com/playlist?list=PLxxxxx" --playlist "Kids Music"
```

### `yoto download <input>`

Download YouTube video or playlist as audio files (legacy command).

```bash
yoto download "https://youtube.com/watch?v=xxxxx"
yoto download "https://youtube.com/playlist?list=PLxxxxx"
yoto download PLxxxxx  # playlist ID
yoto download xxxxx    # video ID
```

#### Options

| Flag | Description |
|------|-------------|
| `-d, --directory <dir>` | Output directory (defaults to ~/Desktop) |

## Smart Merge

When syncing to an existing Yoto playlist, the CLI uses fuzzy matching to:

- **Keep** existing tracks that match YouTube titles (preserves icons and metadata)
- **Add** new tracks from YouTube
- **Remove** tracks no longer in the YouTube playlist

The sync plan is shown before any changes are made, requiring confirmation.

## Config Files

Stored in `~/.config/yoto/`:

- `auth.json` - Authentication token
- `playlists.json` - YouTube → Yoto playlist associations

## Development

```bash
npm run dev -- <command>    # Run without building
npm run build               # Compile TypeScript
npm start                   # Run compiled version
```
