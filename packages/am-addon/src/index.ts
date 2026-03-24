import { createAddon } from "@resonance-addons/sdk";
import { handleLyrics } from "./routes/lyrics";
import { handleMetadata } from "./routes/metadata";
import { setUserToken } from "./token";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

interface AMConfig {
  userToken: string;
}

const addon = createAddon<AMConfig>({
  id: "com.resonance.am-lyrics-remote",
  name: "Apple Music Enhancements",
  description: "Lyrics, metadata, and artwork from Apple Music",
  version: "1.0.0",
  icon: { type: "bundled", value: "applemusic" },

  auth: {
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

  configurePage: `${import.meta.dir}/../templates/configure.html`,
  onDeviceFetchHosts: ["music.apple.com", "*.music.apple.com"],

  parseConfig: (raw) => {
    if (!raw.userToken) throw new Error("Missing userToken");
    return { userToken: raw.userToken as string };
  },

  onConfig: (config) => setUserToken(config.userToken),

  lyrics: {
    syncTypes: ["wordSynced", "lineSynced"],
    handler: (_config, params) => handleLyrics(params.title, params.artist, params.videoId),
  },

  metadata: {
    handler: (_config, params) => handleMetadata(params.title, params.artist),
  },
});

addon.listen(PORT);
