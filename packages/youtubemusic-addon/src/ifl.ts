import { ytFetch } from "./auth";
import type { YouTubeMusicConfig } from "./types";
import { unwrapPlaylistPanelVideo } from "./utils";

interface IFLEntry {
  promise: Promise<string>;
  reads: number;
  expires: number;
}

const cache = new Map<string, IFLEntry>();

async function fetchRandomSeed(config: YouTubeMusicConfig): Promise<string> {
  const lmData = await ytFetch("next", config, {
    playlistId: "LM",
    params: "wAEB",
    isAudioOnly: true,
    enablePersistentPlaylistPanel: true,
  });

  const panel =
    lmData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer
      ?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer;

  const seeds = (panel?.contents ?? [])
    .map((c: any) => unwrapPlaylistPanelVideo(c)?.videoId)
    .filter(Boolean) as string[];

  if (seeds.length === 0) throw new Error("No liked music tracks found for IFL");

  const pick = seeds[Math.floor(Math.random() * seeds.length)];
  console.log(`[ifl] Picked random seed: ${pick}`);
  return pick!;
}

export async function resolveIFL(config: YouTubeMusicConfig): Promise<string> {
  const cacheKey = config.refreshToken;
  const existing = cache.get(cacheKey);
  if (existing && existing.expires > Date.now()) {
    existing.reads++;
    if (existing.reads >= 2) cache.delete(cacheKey);
    return existing.promise;
  }

  const entry: IFLEntry = {
    promise: fetchRandomSeed(config),
    reads: 1,
    expires: Date.now() + 5_000,
  };
  cache.set(cacheKey, entry);
  return entry.promise;
}
