import { createAddon } from "@resonance-addons/sdk";
import { scrapeSecret } from "./auth";
import { prewarmClientToken } from "./partner";
import { handleAlbum } from "./routes/album";
import { handleArtist } from "./routes/artist";
import { handleHome } from "./routes/catalog";
import { handleDJPlaylist } from "./routes/dj";
import { handleLibrary } from "./routes/library";
import { handleLyrics } from "./routes/lyrics";
import { handleMetadata } from "./routes/metadata";
import { handleAddToPlaylist, handleLikedSongs, handlePlaylist, handlePlaylistMore } from "./routes/playlist";
import { handleRelated, handleRelatedForTrack } from "./routes/related";
import { handleSearch, handleSearchSuggestions } from "./routes/search";
import { handleTTS } from "./routes/tts";

const PORT = parseInt(process.env.PORT ?? "3002", 10);

interface SpotifyConfig {
  spDc: string;
}

const addon = createAddon<SpotifyConfig>({
  id: "com.resonance.spotify",
  name: "Spotify",
  description: "Lyrics, metadata, and DJ from your Spotify account",
  version: "1.0.0",
  icon: {
    type: "remote",
    value: "https://storage.googleapis.com/pr-newsroom-wp/1/2023/05/Spotify_Primary_Logo_RGB_Green.png",
  },

  auth: {
    label: "Enter your sp_dc cookie. See /configure for instructions.",
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

  configurePage: `${import.meta.dir}/../templates/configure.html`,

  parseConfig: (raw) => {
    if (!raw.spDc) throw new Error("Missing spDc");
    return { spDc: raw.spDc as string };
  },

  onStart: () => {
    Promise.all([scrapeSecret(), prewarmClientToken()]).catch(() => {});
  },

  catalog: {
    home: {
      name: "Home",
      isDefault: true,
      handler: (config) => handleHome(config.spDc),
    },
    library: {
      name: "Library",
      handler: (config, params) => handleLibrary(config.spDc, params.type, params.continuation),
    },
  },

  search: {
    handler: (config, query, filter) => handleSearch(config.spDc, query, filter),
    suggestions: (config, query) => handleSearchSuggestions(config.spDc, query),
  },

  lyrics: {
    syncTypes: ["wordSynced", "lineSynced"],
    handler: (config, params) => handleLyrics(config.spDc, params.title, params.artist, params.videoId),
  },

  metadata: {
    handler: (config, params) => handleMetadata(config.spDc, params.title, params.artist),
  },

  album: (config, id) => handleAlbum(config.spDc, id),
  artist: (config, id) => handleArtist(config.spDc, id),

  playlist: {
    handler: (config, id) => handlePlaylist(config.spDc, id),
    more: (config, id, cont) => handlePlaylistMore(config.spDc, id, cont),
    custom: {
      "collection:tracks": (config) => handleLikedSongs(config.spDc),
      dj: (config) => handleDJPlaylist(config.spDc),
    },
  },

  related: {
    handler: (config, browseId) => handleRelated(config.spDc, browseId),
    forTrack: (config, trackId) => handleRelatedForTrack(config.spDc, trackId),
  },

  mutations: {
    addToPlaylist: (config, body) => handleAddToPlaylist(config.spDc, body),
  },

  tts: {
    voices: [
      { id: "1", name: "Voice 1" },
      { id: "2", name: "Voice 2" },
      { id: "3", name: "Voice 3" },
      { id: "4", name: "Voice 4" },
      { id: "5", name: "Voice 5" },
      { id: "6", name: "Voice 6" },
      { id: "7", name: "Voice 7" },
      { id: "8", name: "Voice 8" },
    ],
    handler: (config, req) => handleTTS(config.spDc, req),
  },

  capabilities: {
    supportsRadio: false,
    supportsQueueActions: false,
    supportsContinuation: true,
    supportsSearchSuggestions: true,
    supportsLikeStatus: false,
    supportsAddToPlaylist: true,
    supportsFilters: false,
    supportsQuickAccess: false,
    supportsRelated: false,
  },
});

addon.listen(PORT);
