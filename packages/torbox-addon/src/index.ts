import { createAddon, json } from "@resonance-addons/sdk";
import { handleSearch } from "./routes/search";
import { handleStream } from "./routes/stream";

const PROVIDER_ID = "com.resonance.torbox";
const PORT = parseInt(process.env.PORT ?? "3003", 10);

interface TorBoxConfig {
  apiKey: string;
  allowUncached: boolean;
}

const addon = createAddon<TorBoxConfig>({
  id: PROVIDER_ID,
  name: "TorBox",
  description: "Stream music from cached torrents via TorBox",
  version: "1.0.0",
  icon: { type: "remote", value: "https://torbox.app/favicon.ico" },

  auth: {
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

  configurePage: `${import.meta.dir}/../templates/configure.html`,

  parseConfig: (raw) => {
    if (!raw.apiKey) throw new Error("Missing apiKey");
    let allowUncached = raw.allowUncached ?? false;
    if (typeof allowUncached === "string") allowUncached = allowUncached === "true";
    return { apiKey: raw.apiKey as string, allowUncached: !!allowUncached };
  },

  stream: {
    idPrefixes: [PROVIDER_ID],
    handler: (config, id) => handleStream(config.apiKey, id, config.allowUncached),
  },

  catalog: {
    home: {
      name: "Home",
      manifest: false,
      handler: () => Promise.resolve(json({ sections: [], filters: [] })),
    },
    library: {
      name: "Library",
      manifest: false,
      handler: () => Promise.resolve(json({ sections: [], filters: [] })),
    },
  },

  search: {
    handler: (config, query, filter, url) => {
      const context = {
        title: url.searchParams.get("title") ?? undefined,
        artist: url.searchParams.get("artist") ?? undefined,
        album: url.searchParams.get("album") ?? undefined,
      };
      return handleSearch(config.apiKey, query, filter, context);
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

addon.listen(PORT);
