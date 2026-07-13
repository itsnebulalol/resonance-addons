import { defineAddon } from "@resonance-addons/sdk";
import { handleAlbum } from "./routes/album";
import { handleArtist } from "./routes/artist";
import { handleHome } from "./routes/catalog";
import { handleHistory } from "./routes/history";
import { handleLibrary } from "./routes/library";
import { handleLyrics } from "./routes/lyrics";
import { handleMetadata } from "./routes/metadata";
import {
  handleAddToPlaylist,
  handleCreatePlaylist,
  handleGetLikeStatus,
  handleRemoveFromPlaylist,
  handleSetLikeStatus,
} from "./routes/mutations";
import { handlePlaylist, handlePlaylistMore } from "./routes/playlist";
import { handleQueueMore, handleQueueStart } from "./routes/queue";
import { handleSearch } from "./routes/search";
import { handleStream } from "./routes/stream";
import { handleTTS } from "./routes/tts";
import { PROVIDER_ID } from "./utils";

interface SpotifyConfig {
  spDc: string;
  wvdUrl?: string;
}

export const addon = defineAddon<SpotifyConfig>({
  id: PROVIDER_ID,
  name: "Spotify",
  description: "Stream, browse, search, manage your library, and sync listening history with Spotify",
  version: "2.0.0",
  icon: {
    type: "remote",
    value: "https://storage.googleapis.com/pr-newsroom-wp/1/2023/05/Spotify_Primary_Logo_RGB_Green.png",
  },
  resources: [
    {
      type: "catalog",
      catalogs: [
        { id: "home", name: "Home", isDefault: true },
        { id: "library", name: "Library" },
      ],
    },
    { type: "stream", idPrefixes: [PROVIDER_ID] },
    { type: "history", idPrefixes: [PROVIDER_ID] },
    { type: "lyrics", syncTypes: ["wordSynced", "lineSynced"] },
    { type: "metadata" },
    { type: "tts" },
  ],
  auth: {
    type: "token",
    label: "Enter your Spotify sp_dc cookie. The Widevine key URL is optional.",
    fields: [
      {
        key: "spDc",
        type: "password",
        title: "Spotify sp_dc Cookie",
        placeholder: "Paste your sp_dc cookie value",
        isRequired: true,
      },
      {
        key: "wvdUrl",
        type: "password",
        title: "Widevine Key URL",
        placeholder: "Paste the direct URL to your Widevine key file",
        isRequired: false,
      },
    ],
  },
  behaviorHints: { configurable: true, configurationRequired: true },
  handlers: {
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

    resolveStream: (config, trackId) => handleStream(config.spDc, trackId, config.wvdUrl),
    recordHistory: (config, trackId, event) => handleHistory(config.spDc, trackId, event),

    search: (config, query, filter) => handleSearch(config.spDc, query, filter),

    getAlbumDetail: (config, id) => handleAlbum(config.spDc, id),
    getPlaylistDetail: (config, id) => handlePlaylist(config.spDc, id),
    loadMorePlaylistTracks: (config, id, continuation) => handlePlaylistMore(config.spDc, id, continuation),
    getArtistDetail: (config, id) => handleArtist(config.spDc, id),

    startQueue: (config, trackId, context) => handleQueueStart(config.spDc, trackId, context),
    loadMore: (config, token) => handleQueueMore(config.spDc, token),

    setLikeStatus: (config, status, trackId) => handleSetLikeStatus(config.spDc, status, trackId),
    getLikeStatus: (config, trackId) => handleGetLikeStatus(config.spDc, trackId),
    addToPlaylist: (config, trackId, playlistId) => handleAddToPlaylist(config.spDc, trackId, playlistId),
    createPlaylist: (config, name) => handleCreatePlaylist(config.spDc, name),
    removeFromPlaylist: (config, trackId, playlistId) => handleRemoveFromPlaylist(config.spDc, trackId, playlistId),

    fetchLyrics: (config, title, artist, videoId) => handleLyrics(config.spDc, title, artist, videoId),
    fetchMetadata: (config, title, artist, trackId, trackProvider, thumbnailURL) =>
      handleMetadata(config.spDc, title, artist, trackId, trackProvider, thumbnailURL),
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
    supportsCreatePlaylist: true,
    supportsRemoveFromPlaylist: true,
    supportsContinuation: true,
  },
});
