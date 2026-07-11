import { defineAddon } from "@resonance-addons/sdk";
import { PROVIDER_ID, type SoundCloudConfig } from "./api";
import { handleHome } from "./routes/catalog";
import { handleAlbum, handleArtist, handlePlaylist, handlePlaylistMore } from "./routes/detail";
import { handleHistory } from "./routes/history";
import { handleLibrary } from "./routes/library";
import { handleMetadata } from "./routes/metadata";
import { handleGetLikeStatus, handleLike } from "./routes/mutations";
import { handleQueueMore, handleQueueStart } from "./routes/queue";
import { handleRelated, handleRelatedForTrack } from "./routes/related";
import { handleSearch, handleSearchSuggestions } from "./routes/search";
import { handleStream } from "./routes/stream";

export const addon = defineAddon<SoundCloudConfig>({
  id: PROVIDER_ID,
  name: "SoundCloud",
  description: "Search, stream, browse, and sync SoundCloud tracks, profiles, albums, playlists, and history",
  version: "1.1.0",
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
    label: "Optional: enter your SoundCloud oauth_token cookie for library, likes, and history.",
    fields: [
      {
        key: "oauthToken",
        type: "password",
        title: "SoundCloud OAuth Token",
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
    supportsAddToPlaylist: false,
    supportsFilters: true,
    supportsQuickAccess: false,
    supportsRelated: true,
  },
});
