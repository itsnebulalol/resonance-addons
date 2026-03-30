import { defineAddon } from "@resonance-addons/sdk";
import { handleSearch } from "./routes/search";
import { handleStream } from "./routes/stream";

const PROVIDER_ID = "com.resonance.torbox";

interface TorBoxConfig {
  apiKey: string;
  allowUncached: boolean;
}

export const addon = defineAddon<TorBoxConfig>({
  id: PROVIDER_ID,
  name: "TorBox",
  description: "Stream music from cached torrents via TorBox",
  version: "1.0.0",
  icon: { type: "remote", value: "https://torbox.app/favicon.ico" },
  resources: [
    { type: "stream", idPrefixes: [PROVIDER_ID] },
    {
      type: "catalog",
      catalogs: [
        { id: "home", name: "Home" },
        { id: "library", name: "Library" },
      ],
    },
  ],

  auth: {
    type: "token",
    label: "Enter your TorBox API key from torbox.app/settings",
    fields: [
      {
        key: "apiKey",
        type: "password",
        title: "TorBox API Key",
        placeholder: "Paste your TorBox API key",
        isRequired: true,
      },
      {
        key: "allowUncached",
        type: "toggle",
        title: "Download uncached torrents",
        placeholder: "Queue uncached torrents so they are ready next time",
        isRequired: false,
      },
    ],
  },
  behaviorHints: { configurable: true, configurationRequired: true },
  handlers: {
    resolveStream: (config, trackId) => handleStream(config.apiKey, trackId, config.allowUncached),
    getCatalog: async (_config, id) => {
      if (id === "home" || id === "library") {
        return { sections: [], filters: [] };
      }
      throw new Error(`Unknown catalog: ${id}`);
    },
    search: (config, query, filter, context) => {
      const searchContext = {
        title: context?.title,
        artist: context?.artist,
        album: context?.album,
      };
      return handleSearch(config.apiKey, query, filter, searchContext);
    },
  },

  capabilities: {
    supportsRadio: false,
    supportsQueueActions: false,
    supportsContinuation: false,
    supportsSearchSuggestions: false,
    supportsLikeStatus: false,
    supportsAddToPlaylist: false,
    supportsFilters: false,
    supportsQuickAccess: false,
    supportsRelated: false,
  },
});
