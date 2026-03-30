import { defineAddon } from "@resonance-addons/sdk";
import { handleAlbum } from "./routes/album";
import { handleArtist } from "./routes/artist";
import { handleHome } from "./routes/catalog";
import { handleLibrary } from "./routes/library";
import { handleLyrics } from "./routes/lyrics";
import { handleAddToPlaylist, handleLike } from "./routes/mutations";
import { handlePlaylist, handlePlaylistMore } from "./routes/playlist";
import { handleQueueAction, handleQueueMore, handleQueueStart } from "./routes/queue";
import { handleRelated, handleRelatedForTrack } from "./routes/related";
import { handleSearch, handleSearchSuggestions } from "./routes/search";
import { handleStream } from "./routes/stream";

const PROVIDER_ID = "com.resonance.ytm";

interface YTMConfig {
  refreshToken: string;
  gl: string;
  hl: string;
}

export const addon = defineAddon<YTMConfig>({
  id: PROVIDER_ID,
  name: "YouTube Music",
  description: "Stream and browse your YouTube Music library",
  version: "1.0.0",
  icon: { type: "remote", value: "https://i.postimg.cc/KjDMdWyX/You-Tube-Music-2024-svg.png" },
  resources: [
    { type: "stream", idPrefixes: [PROVIDER_ID] },
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
    label: "Enter your Google OAuth refresh token.",
    fields: [
      { key: "refreshToken", type: "password", title: "Google OAuth Refresh Token", isRequired: true },
      { key: "gl", type: "text", title: "Region", defaultValue: "US" },
      { key: "hl", type: "text", title: "Language", defaultValue: "en" },
    ],
  },
  behaviorHints: { configurable: true, configurationRequired: true },
  handlers: {
    resolveStream: (config, trackId) => handleStream(config.refreshToken, trackId),
    getCatalog: (config, id, extra) => {
      const params = extra?.params ?? extra ?? {};
      if (id === "home") {
        return handleHome(config.refreshToken, params.continuation);
      }
      if (id === "library") {
        return handleLibrary(config.refreshToken, params.type, params.continuation);
      }
      throw new Error(`Unknown catalog: ${id}`);
    },
    search: (config, query, filter) => handleSearch(config.refreshToken, query, filter),
    searchSuggestions: (config, query) => handleSearchSuggestions(config.refreshToken, query),
    fetchLyrics: (config, title, artist, videoId) => handleLyrics(config.refreshToken, videoId, title, artist),
    getAlbumDetail: (config, id) => handleAlbum(config.refreshToken, id),
    getArtistDetail: (config, id) => handleArtist(config.refreshToken, id),
    getPlaylistDetail: (config, id) => handlePlaylist(config.refreshToken, id),
    loadMorePlaylistTracks: (config, id, continuation) => handlePlaylistMore(config.refreshToken, id, continuation),
    getRelated: (config, browseId) => handleRelated(config.refreshToken, browseId),
    getRelatedForTrack: (config, trackId) => handleRelatedForTrack(config.refreshToken, trackId),
    startQueue: (config, trackId, context) => handleQueueStart(config.refreshToken, trackId, context),
    loadMore: (config, token) => handleQueueMore(config.refreshToken, token),
    executeAction: (config, action) => handleQueueAction(config.refreshToken, action),
    setLikeStatus: (config, status, videoId) =>
      handleLike(config.refreshToken, { status: status as "liked" | "disliked" | "none", videoId }).then(() => {}),
    addToPlaylist: (config, trackId, playlistId) =>
      handleAddToPlaylist(config.refreshToken, { videoId: trackId, playlistId }).then(() => {}),
  },

  capabilities: {
    supportsRadio: true,
    supportsQueueActions: true,
    supportsContinuation: true,
    supportsSearchSuggestions: true,
    supportsLikeStatus: true,
    supportsAddToPlaylist: true,
    supportsFilters: true,
    supportsQuickAccess: true,
    supportsRelated: true,
  },
});
