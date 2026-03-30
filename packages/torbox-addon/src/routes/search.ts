import { qualityScore, rankResults, searchTPB } from "../search-torrents";
import { checkCached } from "../torbox";
import { formatSize, PROVIDER_ID } from "../utils";

export interface SearchContext {
  title?: string;
  artist?: string;
  album?: string;
}

function stripFeatTags(s: string): string {
  return s
    .replace(/\s*[([](feat\.?|ft\.?|prod\.?|with)\s+[^)\]]*[)\]]/gi, "")
    .replace(/\s*-\s*(feat\.?|ft\.?)\s+.*/gi, "")
    .trim();
}

export async function handleSearch(
  apiKey: string,
  query: string,
  filter?: string,
  context?: SearchContext,
): Promise<any[]> {
  try {
    if (filter && filter !== "tracks") return [];

    const artist = context?.artist;
    const album = context?.album;
    const title = context?.title ? stripFeatTags(context.title) : undefined;

    const queries: string[] = [];
    if (artist && album) {
      queries.push(`${artist} ${album} FLAC`);
      queries.push(`${artist} ${album}`);
    }
    if (artist && title && title !== album) {
      queries.push(`${artist} ${title} FLAC`);
    }
    queries.push(query);

    const seen = new Set<string>();
    const uniqueQueries = queries.filter((q) => {
      const key = q.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const searchResults = await Promise.all(uniqueQueries.map((q) => searchTPB(q)));
    const allResults = searchResults
      .flat()
      .filter((r, i, arr) => arr.findIndex((x) => x.infoHash === r.infoHash) === i);
    const ranked = rankResults(allResults);
    const top = ranked.slice(0, 30);

    const hashes = top.map((r) => r.infoHash);
    const cached = hashes.length ? await checkCached(apiKey, hashes) : [];
    const cachedSet = new Set(cached.map((c) => c.hash));

    const items: any[] = [];

    if (title && artist && top.length > 0) {
      const hasCached = cached.length > 0;
      const trackId = album ? `${title}--${artist}--${album}` : `${title}--${artist}`;

      items.push({
        type: "track",
        track: {
          id: trackId,
          provider: PROVIDER_ID,
          title,
          artists: [{ id: null, name: artist }],
          album: album ? { id: null, name: album } : null,
          duration: null,
          durationSeconds: null,
          thumbnailURL: null,
          isExplicit: false,
          subtitle: hasCached ? "FLAC · ⚡ Cached on TorBox" : "Torrent · TorBox",
        },
      });
    }

    for (const r of top) {
      const isCached = cachedSet.has(r.infoHash);
      const qScore = qualityScore(r.name);
      const format = qScore >= 70 ? "FLAC" : qScore >= 50 ? "MP3 320k" : "MP3";

      const nameMatch = r.name.match(/^(.+?)\s*-\s*(.+?)(?:\s*\(|\s*\[)/);
      const parsedArtist = nameMatch?.[1]?.trim() ?? "Unknown Artist";
      const albumRaw = nameMatch?.[2]?.trim() ?? r.name;

      items.push({
        type: "track",
        track: {
          id: `${albumRaw}--${parsedArtist}`,
          provider: PROVIDER_ID,
          title: r.name,
          artists: [{ id: null, name: parsedArtist }],
          album: null,
          duration: null,
          durationSeconds: null,
          thumbnailURL: null,
          isExplicit: false,
          subtitle: `${format} · ${formatSize(r.size)} · ${r.seeders} seeds${isCached ? " · ⚡ Cached" : ""}`,
        },
      });
    }

    return items;
  } catch (e: any) {
    console.error("[search] Error:", e.message);
    return [];
  }
}
