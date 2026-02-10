import {existsSync, readFileSync, writeFileSync} from "node:fs"

import {ensureConfigDir, TRACKS_FILE} from "./paths.server"

// Track types - ordered array to preserve track order
type SyncedTrack = {
    youtubeVideoId: string
    title: string
    syncedAt: string
    yotoTrackKey: string
}

type CardTracks = {
    videos: SyncedTrack[]
    youtubePlaylistId?: string
    lastSynced: string
}

type Tracks = Record<string, CardTracks>

const readTracks = (): Tracks => {
    if (!existsSync(TRACKS_FILE)) {
        return {}
    }

    const content = readFileSync(TRACKS_FILE, "utf-8")

    try {
        return JSON.parse(content) as Tracks
    } catch {
        throw new Error("Corrupted tracks file: ~/.config/yoto/tracks.json")
    }
}

const writeTracks = (tracks: Tracks): void => {
    ensureConfigDir()
    writeFileSync(TRACKS_FILE, JSON.stringify(tracks, null, 4))
}

const getCardTracks = (cardId: string): CardTracks | null => {
    const tracks = readTracks()
    return tracks[cardId] ?? null
}

const setCardTracks = (cardId: string, cardTracks: CardTracks): void => {
    const tracks = readTracks()
    tracks[cardId] = {
        ...cardTracks,
        lastSynced: new Date().toISOString(),
    }
    writeTracks(tracks)
}

const isVideoSynced = (cardId: string, youtubeVideoId: string): boolean => {
    const cardTracks = getCardTracks(cardId)
    if (!cardTracks) {
        return false
    }
    return cardTracks.videos.some(v => v.youtubeVideoId === youtubeVideoId)
}

const addSyncedTrack = (cardId: string, track: SyncedTrack): void => {
    const tracks = readTracks()
    const cardTracks = tracks[cardId] ?? {
        videos: [],
        lastSynced: track.syncedAt,
    }

    // Don't add if already exists
    if (
        cardTracks.videos.some(v => v.youtubeVideoId === track.youtubeVideoId)
    ) {
        return
    }

    cardTracks.videos.push(track)
    cardTracks.lastSynced = track.syncedAt
    tracks[cardId] = cardTracks
    writeTracks(tracks)
}

const getSyncedVideoIds = (cardId: string): Set<string> => {
    const cardTracks = getCardTracks(cardId)
    if (!cardTracks) {
        return new Set()
    }
    return new Set(cardTracks.videos.map(v => v.youtubeVideoId))
}

const removeCardTracks = (cardId: string): void => {
    const tracks = readTracks()
    delete tracks[cardId]
    writeTracks(tracks)
}

const removeSyncedTrack = (cardId: string, yotoTrackKey: string): void => {
    const tracks = readTracks()
    const cardTracks = tracks[cardId]

    if (!cardTracks) {
        return
    }

    cardTracks.videos = cardTracks.videos.filter(
        v => v.yotoTrackKey !== yotoTrackKey,
    )

    cardTracks.lastSynced = new Date().toISOString()
    tracks[cardId] = cardTracks

    writeTracks(tracks)
}

export {
    addSyncedTrack,
    getCardTracks,
    getSyncedVideoIds,
    isVideoSynced,
    readTracks,
    removeCardTracks,
    removeSyncedTrack,
    setCardTracks,
    writeTracks,
}

export type {CardTracks, SyncedTrack, Tracks}
