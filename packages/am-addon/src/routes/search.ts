import { amFetch } from "../cached-fetch";
import { getDeveloperToken } from "../token";

const API_BASE = "https://amp-api.music.apple.com";
const STOREFRONT = "us";

export interface SearchResult {
  songId: string;
  durationSeconds: number | null;
}

export async function searchSong(title: string, artist: string): Promise<SearchResult | null> {
  const token = await getDeveloperToken();
  const term = `${title} ${artist}`;
  const url = `${API_BASE}/v1/catalog/${STOREFRONT}/search?term=${encodeURIComponent(term)}&types=songs&limit=5`;

  const res = await amFetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://music.apple.com",
      Referer: "https://music.apple.com/",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    console.error(`[search] HTTP ${res.status}`);
    return null;
  }

  const data = (await res.json()) as any;
  const songs = data?.results?.songs?.data as any[] | undefined;
  if (!songs?.length) return null;

  const trackArtist = artist.toLowerCase();

  for (const song of songs) {
    const attrs = song?.attributes;
    if (!attrs) continue;
    const songArtist = (attrs.artistName as string).toLowerCase();
    if (trackArtist.includes(songArtist) || songArtist.includes(trackArtist)) {
      const durationMs = attrs.durationInMillis as number | undefined;
      return {
        songId: song.id as string,
        durationSeconds: durationMs ? Math.round(durationMs / 1000) : null,
      };
    }
  }

  const first = songs[0];
  const durationMs = first?.attributes?.durationInMillis as number | undefined;
  return {
    songId: first.id as string,
    durationSeconds: durationMs ? Math.round(durationMs / 1000) : null,
  };
}
