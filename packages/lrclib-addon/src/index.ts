import { defineAddon } from "@resonance-addons/sdk";
import { handleLyrics } from "./routes/lyrics";

const PROVIDER_ID = "com.resonance.lrclib";

export const addon = defineAddon({
  id: PROVIDER_ID,
  name: "LRCLIB",
  description: "Fetch synced and plain lyrics from LRCLIB",
  version: "1.0.0",
  icon: {
    type: "remote",
    value: "https://lrclib.net/assets/lrclib-370c57eb.png",
  },
  resources: [{ type: "lyrics", syncTypes: ["lineSynced", "unsynced"] }],
  behaviorHints: { configurable: false, configurationRequired: false },
  handlers: {
    fetchLyrics: (_config, title, artist, videoId) => handleLyrics(title, artist, videoId),
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
