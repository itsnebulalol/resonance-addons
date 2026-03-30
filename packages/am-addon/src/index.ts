import { defineAddon } from "@resonance-addons/sdk";
import { handleLyrics } from "./routes/lyrics";
import { handleMetadata } from "./routes/metadata";
import { setUserToken } from "./token";

interface AMConfig {
  userToken: string;
}

export const addon = defineAddon<AMConfig>({
  id: "com.resonance.am-lyrics-remote",
  name: "Apple Music Enhancements",
  description: "Lyrics, metadata, and artwork from Apple Music",
  version: "1.0.0",
  icon: { type: "bundled", value: "applemusic" },
  resources: [{ type: "lyrics", syncTypes: ["wordSynced", "lineSynced"] }, { type: "metadata" }],
  auth: {
    type: "token",
    label: "Enter your Media User Token. See /configure for instructions.",
    fields: [
      {
        key: "userToken",
        type: "password",
        title: "Media User Token",
        placeholder: "Paste your Media User Token here",
        isRequired: true,
      },
    ],
  },
  behaviorHints: { configurable: true, configurationRequired: true },
  handlers: {
    fetchLyrics: (config, title, artist, videoId) => {
      setUserToken(config.userToken);
      return handleLyrics(title, artist, videoId);
    },
    fetchMetadata: (config, title, artist) => {
      setUserToken(config.userToken);
      return handleMetadata(title, artist);
    },
  },
});
