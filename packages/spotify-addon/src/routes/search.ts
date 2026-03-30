import { AddonError } from "@resonance-addons/sdk";
import { spotifyFetch } from "../auth";
import type { SearchAlbum, SearchArtist, SearchPlaylist, SearchResultItem, Track } from "../types";
import { PROVIDER_ID, spclientGet, uriToId } from "../utils";

interface SearchArtistHit {
  name: string;
  uri?: string;
}

interface TrackHit {
  uri: string;
  name: string;
  image?: string;
  artists?: SearchArtistHit[];
}

interface AlbumHit {
  uri: string;
  name: string;
  image?: string;
  artists?: SearchArtistHit[];
}

interface ArtistHit {
  uri: string;
  name: string;
  image?: string;
}

interface PlaylistHit {
  uri: string;
  name: string;
  image?: string;
  owner?: { name?: string };
}

interface SearchResponse {
  results?: {
    tracks?: { hits?: TrackHit[] };
    albums?: { hits?: AlbumHit[] };
    artists?: { hits?: ArtistHit[] };
    playlists?: { hits?: PlaylistHit[] };
  };
}

function trackItem(hit: TrackHit): SearchResultItem {
  const track: Track = {
    id: uriToId(hit.uri),
    provider: PROVIDER_ID,
    title: hit.name ?? "",
    artists: (hit.artists ?? []).map((artist) => ({
      id: artist.uri ? uriToId(artist.uri) : null,
      name: artist.name ?? "",
    })),
    album: null,
    duration: null,
    durationSeconds: null,
    thumbnailURL: hit.image ?? null,
    isExplicit: false,
  };

  return { type: "track", track };
}

function albumItem(hit: AlbumHit): SearchResultItem {
  const album: SearchAlbum = {
    id: uriToId(hit.uri),
    provider: PROVIDER_ID,
    title: hit.name ?? "",
    artists: (hit.artists ?? []).map((artist) => ({
      id: artist.uri ? uriToId(artist.uri) : null,
      name: artist.name ?? "",
    })),
    year: null,
    thumbnailURL: hit.image ?? null,
    isExplicit: false,
  };

  return { type: "album", album };
}

function artistItem(hit: ArtistHit): SearchResultItem {
  const artist: SearchArtist = {
    id: uriToId(hit.uri),
    provider: PROVIDER_ID,
    name: hit.name ?? "",
    thumbnailURL: hit.image ?? null,
    subscriberCount: null,
  };

  return { type: "artist", artist };
}

function playlistItem(hit: PlaylistHit): SearchResultItem {
  const playlist: SearchPlaylist = {
    id: uriToId(hit.uri),
    provider: PROVIDER_ID,
    title: hit.name ?? "",
    author: hit.owner?.name ?? null,
    trackCount: null,
    thumbnailURL: hit.image ?? null,
  };

  return { type: "playlist", playlist };
}

export async function handleSearch(spDc: string, query: string, filter?: string): Promise<SearchResultItem[]> {
  try {
    const typeMap: Record<string, string> = {
      songs: "track",
      albums: "album",
      artists: "artist",
      playlists: "playlist",
    };

    const entityType = filter && typeMap[filter] ? typeMap[filter] : "track,album,artist,playlist";
    const data = (await spclientGet(
      spDc,
      `/searchview/km/v4/search/${encodeURIComponent(query)}?limit=20&entityType=${encodeURIComponent(entityType)}&catalogue=&country=US&locale=en&platform=web`,
    )) as SearchResponse;

    const tracks = (data?.results?.tracks?.hits ?? []).map((hit) => trackItem(hit));
    const albums = (data?.results?.albums?.hits ?? []).map((hit) => albumItem(hit));
    const artists = (data?.results?.artists?.hits ?? []).map((hit) => artistItem(hit));
    const playlists = (data?.results?.playlists?.hits ?? []).map((hit) => playlistItem(hit));

    if (filter && typeMap[filter]) {
      switch (typeMap[filter]) {
        case "track":
          return tracks;
        case "album":
          return albums;
        case "artist":
          return artists;
        case "playlist":
          return playlists;
        default:
          return tracks;
      }
    }

    const mixed: SearchResultItem[] = [...tracks];
    const albumQueue = [...albums];
    const artistQueue = [...artists];
    const playlistQueue = [...playlists];

    while (albumQueue.length || artistQueue.length || playlistQueue.length) {
      if (albumQueue.length) mixed.push(albumQueue.shift()!);
      if (artistQueue.length) mixed.push(artistQueue.shift()!);
      if (playlistQueue.length) mixed.push(playlistQueue.shift()!);
    }

    return mixed;
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to search", 500);
  }
}

export async function searchSpotifyTrack(
  token: string,
  title: string,
  artist: string,
): Promise<{ id: string; image: string | null } | null> {
  const query = encodeURIComponent(`${title} ${artist}`);
  const res = await spotifyFetch(
    `https://spclient.wg.spotify.com/searchview/km/v4/search/${query}?limit=5&entityType=track&catalogue=&country=US&locale=en&platform=web`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "app-platform": "WebPlayer",
      },
    },
  );

  if (!res.ok) return null;

  const data = (await res.json()) as SearchResponse;
  const hits = data?.results?.tracks?.hits ?? [];
  if (!hits.length) return null;

  const artistLower = artist.toLowerCase();
  for (const hit of hits) {
    for (const a of hit.artists ?? []) {
      const name = a.name.toLowerCase();
      if (name.includes(artistLower) || artistLower.includes(name)) {
        return { id: uriToId(hit.uri), image: hit.image ?? null };
      }
    }
  }

  return { id: uriToId(hits[0]!.uri), image: hits[0]!.image ?? null };
}
