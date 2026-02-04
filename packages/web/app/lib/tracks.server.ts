// Re-export tracks functions for server-side use only
// This prevents node:fs from being bundled into client code

export {
    addSyncedTrack,
    getCardTracks,
    getSyncedVideoIds,
    isVideoSynced,
    readTracks,
    setCardTracks,
    writeTracks,
} from "@yoto/core/tracks"

export type {CardTracks, SyncedTrack, Tracks} from "@yoto/core/tracks"
