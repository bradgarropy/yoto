# Yoto Sync

A web application for syncing YouTube content to Yoto cards. Download audio from YouTube videos or playlists and upload them directly to your Yoto cards. Deployed on Cloudflare Workers with Containers for YouTube downloading.

## Features

- Browse and manage your Yoto cards
- Import audio from YouTube videos and playlists
- Drag-and-drop track reordering
- Track deletion and card management
- Search and sort cards

## Prerequisites

- Node.js 20+
- [Docker Desktop](https://docs.docker.com/desktop/) (for local development)

## Installation

```bash
git clone https://github.com/bradgarropy/yoto.git
cd yoto
npm install
```

## Usage

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### First Time Setup

1. Click "Login" to authenticate with your Yoto account
2. Follow the device code flow instructions
3. Once logged in, you'll see all your Yoto cards

### Syncing YouTube Content

1. Navigate to a card's detail page
2. Click "Add Tracks"
3. Paste a YouTube video or playlist URL
4. Click "Import" and wait for the sync to complete

## Development

```bash
npm run dev         # Start development server
npm run build       # Build for production
npm run deploy      # Build and deploy to Cloudflare
npm run test        # Run tests
npm run lint        # Check for lint errors
npm run typecheck   # Check TypeScript types
npm run format      # Check code formatting
```

### Local Development with Containers

This app uses [Cloudflare Containers](https://developers.cloudflare.com/containers/) for YouTube downloading via yt-dlp. For local development:

1. **Docker must be installed and running** - The Vite dev server uses Docker to run containers locally
2. **First run builds the container** - Takes 2-3 minutes; subsequent runs use cached layers
3. **Rebuild containers** - Press `r` + Enter in the terminal to rebuild after Dockerfile changes

The local development environment runs your Worker code in [workerd](https://github.com/cloudflare/workerd) (the same runtime as production) and containers in Docker, providing near-production behavior.

## Project Structure

```
yoto/
├── app/
│   ├── routes/           # React Router pages
│   │   ├── home.tsx      # Card grid dashboard
│   │   ├── login.tsx     # Device code auth flow
│   │   └── cards.$id.tsx # Card detail with tracks
│   ├── components/ui/    # shadcn/ui components
│   └── lib/              # Server-side utilities
│       ├── auth.server.ts
│       ├── youtube.server.ts
│       └── sync.server.ts
├── public/               # Static assets
└── images/               # Image assets
```

## Tech Stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) - Edge runtime
- [Cloudflare Containers](https://developers.cloudflare.com/containers/) - Serverless containers for yt-dlp
- [React Router v7](https://reactrouter.com/) - Full-stack React framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - YouTube downloading (runs in container)
- [@yotoplay/yoto-sdk](https://www.npmjs.com/package/@yotoplay/yoto-sdk) - Yoto API client
