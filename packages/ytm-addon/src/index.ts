import { createAddon } from "@resonance-addons/sdk";
import { runWithRegion } from "./auth";
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
const PORT = parseInt(process.env.PORT ?? "3000", 10);

interface YTMConfig {
  refreshToken: string;
  gl: string;
  hl: string;
}

const addon = createAddon<YTMConfig>({
  id: PROVIDER_ID,
  name: "YouTube Music",
  description: "Stream and browse your YouTube Music library",
  version: "1.0.0",
  icon: { type: "remote", value: "https://i.postimg.cc/KjDMdWyX/You-Tube-Music-2024-svg.png" },

  auth: {
    label: "Enter your Google OAuth refresh token. See the addon's /configure page for instructions.",
    fields: [
      {
        key: "refreshToken",
        type: "password",
        title: "Google OAuth Refresh Token",
        placeholder: "Paste your refresh token here",
        isRequired: true,
      },
      {
        key: "region",
        type: "text",
        title: "Region",
        placeholder: "US",
        isRequired: false,
      },
      {
        key: "language",
        type: "text",
        title: "Language",
        placeholder: "en",
        isRequired: false,
      },
    ],
  },

  configurePage: `${import.meta.dir}/../templates/configure.html`,
  onDeviceFetchHosts: ["oauthaccountmanager.googleapis.com", "music.youtube.com"],

  parseConfig: (raw) => {
    if (!raw.refreshToken) throw new Error("Missing refreshToken");
    return {
      refreshToken: raw.refreshToken as string,
      gl: (raw.region as string) ?? "US",
      hl: (raw.language as string) ?? "en",
    };
  },

  wrapRequest: (config, handler) => runWithRegion(config.gl, config.hl, handler),

  stream: {
    idPrefixes: [PROVIDER_ID],
    handler: (config, id) => handleStream(config.refreshToken, id),
  },

  catalog: {
    home: {
      name: "Home",
      isDefault: true,
      handler: (config, params) => handleHome(config.refreshToken, params.continuation),
    },
    library: {
      name: "Library",
      handler: (config, params) => handleLibrary(config.refreshToken, params.type, params.continuation),
    },
  },

  search: {
    handler: (config, query, filter) => handleSearch(config.refreshToken, query, filter),
    suggestions: (config, query) => handleSearchSuggestions(config.refreshToken, query),
  },

  lyrics: {
    syncTypes: ["lineSynced", "unsynced"],
    handler: (config, params) => handleLyrics(config.refreshToken, params.videoId, params.title, params.artist),
  },

  album: (config, id) => handleAlbum(config.refreshToken, id),
  artist: (config, id) => handleArtist(config.refreshToken, id),

  playlist: {
    handler: (config, id) => handlePlaylist(config.refreshToken, id),
    more: (config, id, cont) => handlePlaylistMore(config.refreshToken, id, cont),
  },

  related: {
    handler: (config, id) => handleRelated(config.refreshToken, id),
    forTrack: (config, id) => handleRelatedForTrack(config.refreshToken, id),
  },

  queue: {
    start: (config, id, context) => handleQueueStart(config.refreshToken, id, context),
    more: (config, token) => handleQueueMore(config.refreshToken, token),
    action: (config, body) => handleQueueAction(config.refreshToken, body),
  },

  mutations: {
    like: (config, body) => handleLike(config.refreshToken, body),
    addToPlaylist: (config, body) => handleAddToPlaylist(config.refreshToken, body),
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

addon.listen(PORT);
