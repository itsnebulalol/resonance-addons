export const ADDONS = [
  {
    packageName: "youtubemusic-addon",
    outputName: "youtubemusic",
    id: "net.itsnebula.youtubemusic",
    name: "YouTube Music",
    version: "2.0.0",
    description: "Stream, browse, search, manage your library, and sync listening history with YouTube Music",
  },
  {
    packageName: "spotify-addon",
    outputName: "spotify",
    id: "net.itsnebula.spotify",
    name: "Spotify",
    version: "2.0.0",
    description: "Stream, browse, search, manage your library, and sync listening history with Spotify",
  },
  {
    packageName: "applemusic-addon",
    outputName: "applemusic",
    id: "net.itsnebula.applemusic",
    name: "Apple Music",
    version: "2.0.0",
    description: "Stream, browse, search, manage your library, and sync listening history with Apple Music",
  },
  {
    packageName: "lrclib-addon",
    outputName: "lrclib",
    id: "net.itsnebula.lrclib",
    name: "LRCLIB",
    version: "1.0.1",
    description: "Fetch synchronized and plain-text lyrics from LRCLIB",
  },
  {
    packageName: "soundcloud-addon",
    outputName: "soundcloud",
    id: "net.itsnebula.soundcloud",
    name: "SoundCloud",
    version: "2.0.0",
    description: "Stream, browse, search, manage your library, and sync listening history with SoundCloud",
  },
] as const;

export type AddonDefinition = (typeof ADDONS)[number];
export type AddonPackageName = AddonDefinition["packageName"];

export function resolveAddons(args: string[]): AddonDefinition[] {
  const option = args.find((arg) => arg.startsWith("--addon="));
  if (!option) return [...ADDONS];

  const requested = option.slice("--addon=".length);
  const addon = ADDONS.find((candidate) => candidate.packageName === requested);
  if (!addon) throw new Error(`Unknown addon package: ${requested}`);
  return [addon];
}
