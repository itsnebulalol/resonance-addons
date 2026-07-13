import { defineAddon } from "@resonance-addons/sdk";
import { handleAlbum } from "./routes/album";
import { handleArtist } from "./routes/artist";
import { handleHome } from "./routes/catalog";
import { handleHistory } from "./routes/history";
import { handleLibrary } from "./routes/library";
import { handleLyrics } from "./routes/lyrics";
import {
  handleAddToPlaylist,
  handleCreatePlaylist,
  handleGetLikeStatus,
  handleLike,
  handleRemoveFromPlaylist,
} from "./routes/mutations";
import { handlePlaylist, handlePlaylistMore } from "./routes/playlist";
import { handleQueueAction, handleQueueMore, handleQueueStart } from "./routes/queue";
import { handleRelated, handleRelatedForTrack } from "./routes/related";
import { handleSearch, handleSearchSuggestions } from "./routes/search";
import { handleStream } from "./routes/stream";
import type { YouTubeMusicConfig } from "./types";
import { PROVIDER_ID } from "./utils";

export const addon = defineAddon<YouTubeMusicConfig>({
  id: PROVIDER_ID,
  name: "YouTube Music",
  description: "Stream, browse, search, manage your library, and sync listening history with YouTube Music",
  version: "2.0.0",
  icon: { type: "remote", value: "https://i.postimg.cc/KjDMdWyX/You-Tube-Music-2024-svg.png" },
  resources: [
    { type: "stream", idPrefixes: [PROVIDER_ID] },
    { type: "history", idPrefixes: [PROVIDER_ID] },
    {
      type: "catalog",
      catalogs: [
        { id: "home", name: "Home", isDefault: true },
        { id: "library", name: "Library" },
      ],
    },
    { type: "lyrics", syncTypes: ["lineSynced", "unsynced"] },
  ],
  auth: {
    type: "token",
    label: "Enter your YouTube Music Google OAuth refresh token.",
    fields: [
      {
        key: "refreshToken",
        type: "password",
        title: "Google OAuth Refresh Token",
        placeholder: "Paste your Google OAuth refresh token",
        isRequired: true,
      },
      { key: "gl", type: "text", title: "Region Code", defaultValue: "US" },
      { key: "hl", type: "text", title: "Language Code", defaultValue: "en" },
    ],
  },
  behaviorHints: { configurable: true, configurationRequired: true },
  handlers: {
    resolveStream: (config, trackId) => handleStream(config, trackId),
    recordHistory: (config, trackId, event) => handleHistory(config, trackId, event),
    getCatalog: (config, id, extra) => {
      const params = extra?.params ?? extra ?? {};
      if (id === "home") {
        return handleHome(config, params.continuation);
      }
      if (id === "library") {
        return handleLibrary(config, params.type, params.continuation);
      }
      throw new Error(`Unknown catalog: ${id}`);
    },
    search: (config, query, filter) => handleSearch(config, query, filter),
    searchSuggestions: (config, query) => handleSearchSuggestions(config, query),
    fetchLyrics: (config, title, artist, videoId) => handleLyrics(config, videoId, title, artist),
    getAlbumDetail: (config, id) => handleAlbum(config, id),
    getArtistDetail: (config, id) => handleArtist(config, id),
    getPlaylistDetail: (config, id) => handlePlaylist(config, id),
    loadMorePlaylistTracks: (config, id, continuation) => handlePlaylistMore(config, id, continuation),
    getRelated: (config, browseId) => handleRelated(config, browseId),
    getRelatedForTrack: (config, trackId) => handleRelatedForTrack(config, trackId),
    startQueue: (config, trackId, context) => handleQueueStart(config, trackId, context),
    loadMore: (config, token) => handleQueueMore(config, token),
    executeAction: (config, action, currentTrack) => handleQueueAction(config, { action, currentTrack }),
    setLikeStatus: (config, status, videoId) =>
      handleLike(config, { status: status as "liked" | "disliked" | "none", videoId }).then(() => {}),
    getLikeStatus: (config, videoId) => handleGetLikeStatus(config, videoId),
    addToPlaylist: (config, trackId, playlistId) =>
      handleAddToPlaylist(config, { videoId: trackId, playlistId }).then(() => {}),
    createPlaylist: (config, name) => handleCreatePlaylist(config, name),
    removeFromPlaylist: (config, trackId, playlistId) =>
      handleRemoveFromPlaylist(config, trackId, playlistId).then(() => {}),
  },

  capabilities: {
    supportsRadio: true,
    supportsQueueActions: true,
    supportsContinuation: true,
    supportsSearchSuggestions: true,
    supportsLikeStatus: true,
    supportsAddToPlaylist: true,
    supportsCreatePlaylist: true,
    supportsRemoveFromPlaylist: true,
    supportsFilters: true,
    supportsQuickAccess: true,
    supportsRelated: true,
  },
});
