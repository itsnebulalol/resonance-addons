import { AddonError } from "@resonance-addons/sdk";
import type { SearchAlbum, SearchArtist, SearchPlaylist, SearchResultItem } from "../types";
import { bestImageFromSources, OperationHash, PROVIDER_ID, pf, transformGraphQLTrack, uriToId } from "../utils";

interface SearchResponse {
  searchV2?: {
    topResultsV2?: {
      itemsV2?: Array<{
        item?: {
          __typename?: string;
          data?: any;
        };
      }>;
    };
  };
}

function albumItem(data: any): SearchResultItem {
  const year =
    typeof data.date?.year === "number" || typeof data.date?.year === "string"
      ? String(data.date.year)
      : typeof data.date?.isoString === "string"
        ? data.date.isoString.slice(0, 4)
        : null;
  const album: SearchAlbum = {
    id: uriToId(data.uri),
    provider: PROVIDER_ID,
    title: data.name ?? "",
    artists: (data.artists?.items ?? []).map((artist: any) => ({
      id: artist.uri ? uriToId(artist.uri) : null,
      name: artist.profile?.name ?? artist.name ?? "",
    })),
    year,
    thumbnailURL: bestImageFromSources(data.coverArt?.sources ?? []),
    isExplicit: data.contentRating?.label === "EXPLICIT",
  };

  return { type: "album", album };
}

function artistItem(data: any): SearchResultItem {
  const artist: SearchArtist = {
    id: uriToId(data.uri),
    provider: PROVIDER_ID,
    name: data.profile?.name ?? data.name ?? "",
    thumbnailURL: bestImageFromSources(data.visuals?.avatarImage?.sources ?? []),
    subscriberCount: null,
  };

  return { type: "artist", artist };
}

function playlistItem(data: any): SearchResultItem {
  const imageSources = (data.images?.items ?? []).flatMap((item: any) => item?.sources ?? []);
  const playlist: SearchPlaylist = {
    id: uriToId(data.uri),
    provider: PROVIDER_ID,
    title: data.name ?? "",
    author: data.ownerV2?.data?.name ?? data.owner?.name ?? null,
    trackCount: null,
    thumbnailURL: bestImageFromSources(imageSources),
  };

  return { type: "playlist", playlist };
}

function searchItem(wrapper: { __typename?: string; data?: any } | undefined): SearchResultItem | null {
  const data = wrapper?.data;
  if (!data?.uri) return null;

  switch (wrapper?.__typename) {
    case "TrackResponseWrapper":
      return { type: "track", track: transformGraphQLTrack(data) };
    case "AlbumResponseWrapper":
      return albumItem(data);
    case "ArtistResponseWrapper":
      return artistItem(data);
    case "PlaylistResponseWrapper":
      return playlistItem(data);
    default:
      return null;
  }
}

export async function handleSearch(spDc: string, query: string, filter?: string): Promise<SearchResultItem[]> {
  try {
    const data = (await pf(spDc, {
      name: "searchSuggestions",
      hash: OperationHash.searchSuggestions,
      variables: {
        query,
        limit: 30,
        numberOfTopResults: 30,
        offset: 0,
        includeAuthors: false,
        includeAlbumPreReleases: false,
        includeEpisodeContentRatingsV2: false,
      },
    })) as SearchResponse;
    const items = (data?.searchV2?.topResultsV2?.itemsV2 ?? [])
      .map((hit) => searchItem(hit.item))
      .filter((item): item is SearchResultItem => item !== null);

    const typeForFilter: Record<string, SearchResultItem["type"]> = {
      songs: "track",
      albums: "album",
      artists: "artist",
      playlists: "playlist",
    };
    const type = filter ? typeForFilter[filter] : undefined;
    return type ? items.filter((item) => item.type === type) : items;
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to search", 500);
  }
}

export async function searchSpotifyTrack(
  spDc: string,
  title: string,
  artist: string,
): Promise<{ id: string; image: string | null } | null> {
  const hits = (await handleSearch(spDc, `${title} ${artist}`, "songs"))
    .filter((item): item is Extract<SearchResultItem, { type: "track" }> => item.type === "track")
    .map((item) => item.track);
  if (!hits.length) return null;

  const artistLower = artist.toLowerCase();
  for (const hit of hits) {
    for (const a of hit.artists) {
      const name = a.name.toLowerCase();
      if (name.includes(artistLower) || artistLower.includes(name)) {
        return { id: hit.id, image: hit.thumbnailURL ?? null };
      }
    }
  }

  return { id: hits[0]!.id, image: hits[0]!.thumbnailURL ?? null };
}
