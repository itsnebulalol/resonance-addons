import { json, PROVIDER_ID } from "../utils";

export function handleManifest(baseURL: string, configStr: string | null): Response {
  return json({
    id: PROVIDER_ID,
    name: "YouTube Music",
    description: "Stream and browse your YouTube Music library",
    version: "1.0.0",
    icon: {
      type: "remote",
      value: "https://i.postimg.cc/KjDMdWyX/You-Tube-Music-2024-svg.png",
    },
    transport: { remote: configStr ? `${baseURL}/${configStr}` : baseURL },
    resources: [
      { type: "stream", idPrefixes: [PROVIDER_ID] },
      {
        type: "catalog",
        catalogs: [
          { id: "home", name: "Home", isDefault: true },
          { id: "library", name: "Library" },
          {
            id: "search",
            name: "Search",
            extra: [{ name: "search", isRequired: true }],
          },
        ],
      },
      { type: "lyrics", syncTypes: ["lineSynced", "unsynced"] },
    ],
    auth: {
      type: "token",
      label: "Enter your Google OAuth refresh token. See the addon's /configure page for instructions.",
      fields: [
        {
          key: "refreshToken",
          type: "password",
          title: "Google OAuth Refresh Token",
          placeholder: "Paste your refresh token here",
          isRequired: true,
        },
      ],
    },
    behaviorHints: { configurable: true, configurationRequired: true },
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
}
