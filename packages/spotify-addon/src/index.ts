import { AddonError, defineAddon } from "@resonance-addons/sdk";
import { handleAlbum } from "./routes/album";
import { handleArtist } from "./routes/artist";
import { handleHome } from "./routes/catalog";
import { handleLibrary } from "./routes/library";
import { handleLyrics } from "./routes/lyrics";
import { handleMetadata } from "./routes/metadata";
import { handleAddToPlaylist, handleGetLikeStatus, handleSetLikeStatus } from "./routes/mutations";
import { handlePlaylist, handlePlaylistMore } from "./routes/playlist";
import { handleQueueMore, handleQueueStart } from "./routes/queue";
import { handleSearch } from "./routes/search";
import { handleTTS } from "./routes/tts";
import { PROVIDER_ID } from "./utils";

interface SpotifyConfig {
  spDc: string;
}

export const addon = defineAddon<SpotifyConfig>({
  id: "com.resonance.spotify",
  name: "Spotify",
  description: "Browse, search, and manage your Spotify library",
  version: "2.0.1",
  icon: {
    type: "remote",
    value: "https://storage.googleapis.com/pr-newsroom-wp/1/2023/05/Spotify_Primary_Logo_RGB_Green.png",
  },
  resources: [
    {
      type: "catalog",
      catalogs: [
        { id: "home", name: "Spotify", isDefault: true },
        { id: "library", name: "Library" },
      ],
    },
    { type: "stream", idPrefixes: [PROVIDER_ID] },
    { type: "lyrics", syncTypes: ["wordSynced", "lineSynced"] },
    { type: "metadata" },
    { type: "tts" },
  ],
  auth: {
    type: "token",
    label: "Enter your sp_dc cookie from open.spotify.com.",
    fields: [
      {
        key: "spDc",
        type: "password",
        title: "sp_dc Cookie",
        placeholder: "Paste your sp_dc cookie value",
        isRequired: true,
      },
    ],
  },
  behaviorHints: { configurable: true, configurationRequired: true },
  handlers: {
    // Catalog
    getCatalog: (config, id, extra) => {
      const params = extra?.params ?? extra ?? {};
      if (id === "home") {
        return handleHome(config.spDc);
      }
      if (id === "library") {
        return handleLibrary(config.spDc, params.type, params.continuation);
      }
      throw new Error(`Unknown catalog: ${id}`);
    },

    resolveStream: () => {
      throw new AddonError("Spotify cannot stream directly — use cross-provider resolution", 501);
    },

    search: (config, query, filter) => handleSearch(config.spDc, query, filter),

    // Details
    getAlbumDetail: (config, id) => handleAlbum(config.spDc, id),
    getPlaylistDetail: (config, id) => handlePlaylist(config.spDc, id),
    loadMorePlaylistTracks: (config, id, continuation) => handlePlaylistMore(config.spDc, id, continuation),
    getArtistDetail: (config, id) => handleArtist(config.spDc, id),

    // Queue
    startQueue: (config, trackId, context) => handleQueueStart(config.spDc, trackId, context),
    loadMore: (config, token) => handleQueueMore(config.spDc, token),

    // Mutations
    setLikeStatus: (config, status, trackId) => handleSetLikeStatus(config.spDc, status, trackId),
    getLikeStatus: (config, trackId) => handleGetLikeStatus(config.spDc, trackId),
    addToPlaylist: (config, trackId, playlistId) => handleAddToPlaylist(config.spDc, trackId, playlistId),

    // Lyrics, Metadata, TTS (existing)
    fetchLyrics: (config, title, artist, videoId) => handleLyrics(config.spDc, title, artist, videoId),
    fetchMetadata: (config, title, artist) => handleMetadata(config.spDc, title, artist),
    getVoices: async () => [
      { id: "1", name: "Voice 1" },
      { id: "2", name: "Voice 2" },
      { id: "3", name: "Voice 3" },
      { id: "4", name: "Voice 4" },
      { id: "5", name: "Voice 5" },
      { id: "6", name: "Voice 6" },
      { id: "7", name: "Voice 7" },
      { id: "8", name: "Voice 8" },
    ],
    synthesize: (config, text, voiceId) => handleTTS(config.spDc, text, voiceId),
  },
  capabilities: {
    supportsLikeStatus: true,
    supportsAddToPlaylist: true,
    supportsContinuation: true,
  },
});
