import { ytFetch } from "./auth";

interface IFLEntry {
  promise: Promise<string>;
  reads: number;
  expires: number;
}

const cache = new Map<string, IFLEntry>();

async function fetchRandomSeed(refreshToken: string): Promise<string> {
  const lmData = await ytFetch("next", refreshToken, {
    playlistId: "LM",
    params: "wAEB",
    isAudioOnly: true,
    enablePersistentPlaylistPanel: true,
  });

  const panel =
    lmData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer
      ?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer;

  const seeds = (panel?.contents ?? [])
    .map((c: any) => c.playlistPanelVideoRenderer?.videoId)
    .filter(Boolean) as string[];

  if (seeds.length === 0) throw new Error("No liked music tracks found for IFL");

  const pick = seeds[Math.floor(Math.random() * seeds.length)];
  console.log(`[ifl] Picked random seed: ${pick}`);
  return pick!;
}

export async function resolveIFL(refreshToken: string): Promise<string> {
  const existing = cache.get(refreshToken);
  if (existing && existing.expires > Date.now()) {
    existing.reads++;
    if (existing.reads >= 2) cache.delete(refreshToken);
    return existing.promise;
  }

  const entry: IFLEntry = {
    promise: fetchRandomSeed(refreshToken),
    reads: 1,
    expires: Date.now() + 5_000,
  };
  cache.set(refreshToken, entry);
  return entry.promise;
}
