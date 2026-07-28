import { defineAddon } from "@resonance-addons/sdk";
import { PROVIDER_ID } from "./api";
import { handleHome, handleLibrary, handleSearch, handleSearchSuggestions } from "./routes/catalog";
import { handleAlbum, handleArtist, handlePlaylist, handlePlaylistMore } from "./routes/detail";
import { handleHistory } from "./routes/history";
import { handleLyrics } from "./routes/lyrics";
import { handleMetadata } from "./routes/metadata";
import {
  handleAddToPlaylist,
  handleCreatePlaylist,
  handleDeletePlaylist,
  handleGetLikeStatus,
  handleLike,
  handleRemovePlaylistEntry,
  handleUpdatePlaylist,
} from "./routes/mutations";
import { handleQueueMore, handleQueueStart, handleStationStart } from "./routes/queue";
import { handleRelated, handleRelatedForTrack } from "./routes/related";
import { handleStream } from "./routes/stream";
import { setUserToken } from "./token";

interface AppleMusicConfig {
  userToken: string;
  serverToken: string;
  serverUrl: string;
}

export const addon = defineAddon<AppleMusicConfig>({
  id: PROVIDER_ID,
  name: "Apple Music",
  description: "Stream, browse, search, manage your library, and sync listening history with Apple Music",
  version: "2.3.0",
  icon: { type: "bundled", value: "applemusic" },
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
    { type: "lyrics", syncTypes: ["wordSynced", "lineSynced"] },
    { type: "metadata" },
  ],
  auth: {
    type: "token",
    label: "Enter your Apple Music Media User Token and the token for your Apple Music streaming server.",
    fields: [
      {
        key: "userToken",
        type: "password",
        title: "Apple Music Media User Token",
        placeholder: "Paste your Media User Token",
        isRequired: true,
      },
      {
        key: "serverToken",
        type: "password",
        title: "Streaming Server Token",
        placeholder: "Paste the token from your Apple Music server .env",
        isRequired: true,
      },
      {
        key: "serverUrl",
        type: "url",
        title: "Streaming Server URL",
        placeholder: "https://applemusic.example.com",
        isRequired: true,
      },
    ],
  },
  behaviorHints: { configurable: true, configurationRequired: true },
  handlers: {
    resolveStream: (config, trackId) => {
      setUserToken(config.userToken);
      return handleStream(trackId, config.serverUrl, config.serverToken);
    },
    recordHistory: (config, trackId, event) => {
      setUserToken(config.userToken);
      return handleHistory(trackId, event);
    },
    getCatalog: (config, id, extra) => {
      setUserToken(config.userToken);
      const params = extra?.params ?? extra ?? {};
      if (id === "home") return handleHome(params.continuation);
      if (id === "library") return handleLibrary(params.type, params.continuation);
      throw new Error(`Unknown catalog: ${id}`);
    },
    search: (config, query, filter) => {
      setUserToken(config.userToken);
      return handleSearch(query, filter);
    },
    searchSuggestions: (config, query) => {
      setUserToken(config.userToken);
      return handleSearchSuggestions(query);
    },
    getAlbumDetail: (config, id) => {
      setUserToken(config.userToken);
      return handleAlbum(id);
    },
    getPlaylistDetail: (config, id) => {
      setUserToken(config.userToken);
      return handlePlaylist(id);
    },
    loadMorePlaylistEntries: (config, id, continuation) => {
      setUserToken(config.userToken);
      return handlePlaylistMore(id, continuation);
    },
    getArtistDetail: (config, id) => {
      setUserToken(config.userToken);
      return handleArtist(id);
    },
    getRelated: (config, browseId) => {
      setUserToken(config.userToken);
      return handleRelated(browseId);
    },
    getRelatedForTrack: (config, trackId) => {
      setUserToken(config.userToken);
      return handleRelatedForTrack(trackId);
    },
    startQueue: (config, trackId, context) => {
      setUserToken(config.userToken);
      return handleQueueStart(trackId, context);
    },
    startStation: (config, station) => {
      setUserToken(config.userToken);
      return handleStationStart(station);
    },
    loadMore: (config, token) => {
      setUserToken(config.userToken);
      return handleQueueMore(token);
    },
    setLikeStatus: (config, status, trackId) => {
      setUserToken(config.userToken);
      return handleLike(status as "liked" | "disliked" | "none", trackId).then(() => {});
    },
    getLikeStatus: (config, trackId) => {
      setUserToken(config.userToken);
      return handleGetLikeStatus(trackId);
    },
    getFavoriteCollection: async () => null,
    addToPlaylist: (config, trackId, playlistId) => {
      setUserToken(config.userToken);
      return handleAddToPlaylist(trackId, playlistId).then(() => {});
    },
    createPlaylist: (config, name) => {
      setUserToken(config.userToken);
      return handleCreatePlaylist(name);
    },
    updatePlaylist: (config, request) => {
      setUserToken(config.userToken);
      return handleUpdatePlaylist(request);
    },
    removeFromPlaylist: (config, entryId, trackId, playlistId) => {
      setUserToken(config.userToken);
      return handleRemovePlaylistEntry(entryId, trackId, playlistId).then(() => {});
    },
    deletePlaylist: (config, playlistId) => {
      setUserToken(config.userToken);
      return handleDeletePlaylist(playlistId).then(() => {});
    },
    fetchLyrics: (config, title, artist, videoId) => {
      setUserToken(config.userToken);
      return handleLyrics(title, artist, videoId);
    },
    fetchMetadata: (config, title, artist, trackId, trackProvider) => {
      setUserToken(config.userToken);
      return handleMetadata(title, artist, trackId, trackProvider);
    },
  },
  capabilities: {
    supportsRadio: true,
    supportsStations: true,
    supportsQueueActions: false,
    supportsContinuation: true,
    supportsSearchSuggestions: true,
    supportsLikeStatus: true,
    supportsAddToPlaylist: true,
    supportsCreatePlaylist: true,
    supportsEditPlaylist: true,
    supportsRemoveFromPlaylist: true,
    supportsDeletePlaylist: true,
    supportsFilters: false,
    supportsQuickAccess: false,
    supportsRelated: true,
  },
});
