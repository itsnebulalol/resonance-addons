import { AddonError } from "@resonance-addons/sdk";
import {
  dedupeSearchItems,
  playableTracks,
  resourceToSearchItem,
  type SoundCloudCollection,
  type SoundCloudConfig,
  type SoundCloudPlaylist,
  type SoundCloudTrack,
  type SoundCloudUser,
  scFetch,
} from "../api";
import type { SearchResultItem } from "../types";

const searchEndpoints: Record<string, string> = {
  songs: "/search/tracks",
  tracks: "/search/tracks",
  albums: "/search/albums",
  artists: "/search/users",
  playlists: "/search/playlists_without_albums",
};

export async function handleSearch(
  config: SoundCloudConfig,
  query: string,
  filter?: string,
): Promise<SearchResultItem[]> {
  try {
    const endpoint = filter ? (searchEndpoints[filter] ?? "/search") : "/search";
    const data = await scFetch<SoundCloudCollection<SoundCloudTrack | SoundCloudPlaylist | SoundCloudUser>>(
      config,
      endpoint,
      {
        q: query,
        limit: 25,
        offset: 0,
        linked_partitioning: 1,
      },
    );

    const playlistMode = filter === "albums" ? "album" : filter === "playlists" ? "playlist" : "auto";
    const items: SearchResultItem[] = [];
    for (const resource of data.collection ?? []) {
      if (resource.kind === "track" && !playableTracks([resource as SoundCloudTrack]).length) continue;
      const item = resourceToSearchItem(resource, playlistMode);
      if (item) items.push(item);
    }

    return dedupeSearchItems(items);
  } catch (error: any) {
    console.error("[soundcloud:search] Error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}

export async function handleSearchSuggestions(config: SoundCloudConfig, query: string): Promise<string[]> {
  try {
    const data = await scFetch<SoundCloudCollection<{ output?: string; query?: string }>>(config, "/search/queries", {
      q: query,
      limit: 10,
    });
    return (data.collection ?? [])
      .map((item) => item.output ?? item.query)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch (error: any) {
    console.error("[soundcloud:search] Suggestions error:", error.message);
    return [];
  }
}
