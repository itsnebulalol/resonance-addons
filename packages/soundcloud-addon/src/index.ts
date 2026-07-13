import { defineAddon } from "@resonance-addons/sdk";
import { PROVIDER_ID, type SoundCloudConfig } from "./api";
import { handleHome } from "./routes/catalog";
import { handleAlbum, handleArtist, handlePlaylist, handlePlaylistMore } from "./routes/detail";
import { handleHistory } from "./routes/history";
import { handleLibrary } from "./routes/library";
import { handleMetadata } from "./routes/metadata";
import {
  handleAddToPlaylist,
  handleCreatePlaylist,
  handleGetLikeStatus,
  handleLike,
  handleRemoveFromPlaylist,
} from "./routes/mutations";
import { handleQueueMore, handleQueueStart } from "./routes/queue";
import { handleRelated, handleRelatedForTrack } from "./routes/related";
import { handleSearch, handleSearchSuggestions } from "./routes/search";
import { handleStream } from "./routes/stream";

export const addon = defineAddon<SoundCloudConfig>({
  id: PROVIDER_ID,
  name: "SoundCloud",
  description: "Stream, browse, search, manage your library, and sync listening history with SoundCloud",
  version: "2.0.0",
  icon: {
    type: "remote",
    value: "https://cdn-icons-png.flaticon.com/512/48/48967.png",
  },
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
    { type: "metadata" },
  ],
  auth: {
    type: "token",
    label: "Enter your SoundCloud oauth_token cookie to enable library, likes, and history. This field is optional.",
    fields: [
      {
        key: "oauthToken",
        type: "password",
        title: "SoundCloud oauth_token Cookie",
        placeholder: "Paste the oauth_token cookie value",
        isRequired: false,
      },
    ],
  },
  behaviorHints: { configurable: true, configurationRequired: false },
  handlers: {
    resolveStream: (config: SoundCloudConfig, trackId: string) => handleStream(config, trackId),
    recordHistory: (config: SoundCloudConfig, trackId: string, event) => handleHistory(config, trackId, event),
    getCatalog: (config: SoundCloudConfig, id: string, extra?: any) => {
      const params = extra?.params ?? extra ?? {};
      if (id === "home") return handleHome(config, params.continuation);
      if (id === "library") return handleLibrary(config, params.type, params.continuation);
      throw new Error(`Unknown catalog: ${id}`);
    },
    search: (config: SoundCloudConfig, query: string, filter?: string) => handleSearch(config, query, filter),
    searchSuggestions: (config: SoundCloudConfig, query: string) => handleSearchSuggestions(config, query),
    getAlbumDetail: (config: SoundCloudConfig, id: string) => handleAlbum(config, id),
    getPlaylistDetail: (config: SoundCloudConfig, id: string) => handlePlaylist(config, id),
    loadMorePlaylistTracks: (config: SoundCloudConfig, id: string, continuation: string) =>
      handlePlaylistMore(config, id, continuation),
    getArtistDetail: (config: SoundCloudConfig, id: string) => handleArtist(config, id),
    startQueue: (config: SoundCloudConfig, trackId: string, context?: any) =>
      handleQueueStart(config, trackId, context),
    loadMore: (config: SoundCloudConfig, token: string) => handleQueueMore(config, token),
    getRelated: (config: SoundCloudConfig, browseId: string) => handleRelated(config, browseId),
    getRelatedForTrack: (config: SoundCloudConfig, trackId: string) => handleRelatedForTrack(config, trackId),
    setLikeStatus: (config: SoundCloudConfig, status: string, trackId: string) =>
      handleLike(config, status as "liked" | "disliked" | "none", trackId).then(() => {}),
    getLikeStatus: (config: SoundCloudConfig, trackId: string) => handleGetLikeStatus(config, trackId),
    addToPlaylist: (config: SoundCloudConfig, trackId: string, playlistId: string) =>
      handleAddToPlaylist(config, trackId, playlistId),
    createPlaylist: (config: SoundCloudConfig, name: string) => handleCreatePlaylist(config, name),
    removeFromPlaylist: (config: SoundCloudConfig, trackId: string, playlistId: string) =>
      handleRemoveFromPlaylist(config, trackId, playlistId),
    fetchMetadata: (
      config: SoundCloudConfig,
      title?: string,
      artist?: string,
      trackId?: string,
      trackProvider?: string,
    ) => handleMetadata(config, title, artist, trackId, trackProvider),
  },
  capabilities: {
    supportsRadio: true,
    supportsQueueActions: false,
    supportsContinuation: true,
    supportsSearchSuggestions: true,
    supportsLikeStatus: true,
    supportsAddToPlaylist: true,
    supportsCreatePlaylist: true,
    supportsRemoveFromPlaylist: true,
    supportsFilters: true,
    supportsQuickAccess: false,
    supportsRelated: true,
  },
});
