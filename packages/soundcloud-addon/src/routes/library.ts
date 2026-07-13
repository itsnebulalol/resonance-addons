import { AddonError } from "@resonance-addons/sdk";
import {
  hasOAuth,
  isAlbumSet,
  PROVIDER_ID,
  playableTracks,
  playlistToSearchPlaylist,
  resourceToHomeItem,
  type SoundCloudCollection,
  type SoundCloudConfig,
  type SoundCloudPlaylist,
  type SoundCloudTrack,
  type SoundCloudUser,
  scFetch,
} from "../api";
import type { CatalogFilter, CatalogPage, HomeItem, HomeSection } from "../types";

type LibraryType = "tracks" | "likes" | "albums" | "playlists" | "artists" | "recent";

const sectionTitles: Record<LibraryType, string> = {
  tracks: "Uploads",
  likes: "Songs",
  albums: "Albums",
  playlists: "Playlists",
  artists: "Artists",
  recent: "Recently Played",
};

export async function handleLibrary(
  config: SoundCloudConfig,
  type?: string,
  continuation?: string,
): Promise<CatalogPage> {
  try {
    const authenticated = hasOAuth(config);
    if (authenticated) return handleAuthenticatedLibrary(config, type, continuation);

    return emptyPage();
  } catch (error: any) {
    console.error("[soundcloud:library] Error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}

async function handleAuthenticatedLibrary(
  config: SoundCloudConfig,
  type?: string,
  continuation?: string,
): Promise<CatalogPage> {
  const user = await scFetch<SoundCloudUser>(config, "/me");
  const currentUserId = user.id == null ? null : String(user.id);
  if (type) {
    const normalized = normalizeType(type, true);
    const section = await loadAuthenticatedSection(config, normalized, continuation, currentUserId);
    return {
      sections: section.items.length ? [section] : [],
      filters: makeFilters(filterKeyFor(normalized), true),
      quickAccess: null,
      continuation: null,
    };
  }

  const results = await Promise.allSettled(
    (["likes", "recent", "tracks", "playlists", "albums", "artists"] as LibraryType[]).map((libraryType) =>
      loadAuthenticatedSection(config, libraryType, undefined, currentUserId),
    ),
  );
  const sections = results
    .filter((result): result is PromiseFulfilledResult<HomeSection> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((section) => section.items.length > 0);

  return { sections, filters: makeFilters(undefined, true), quickAccess: null, continuation: null };
}

async function loadPublicSection(
  config: SoundCloudConfig,
  source: string,
  type: LibraryType,
  continuation?: string,
  currentUserId?: string | null,
): Promise<HomeSection> {
  const endpoint = endpointFor(source, type);
  const data = await fetchCollection(config, endpoint, continuation);
  const items = mapLibraryItems(type, data.collection ?? [], currentUserId);
  return makeSection(type, items, data.next_href);
}

async function loadAuthenticatedSection(
  config: SoundCloudConfig,
  type: LibraryType,
  continuation?: string,
  currentUserId?: string | null,
): Promise<HomeSection> {
  if (type === "likes") {
    const source = await authenticatedUserSource(config);
    if (!source) return makeSection(type, [], null);
    return loadPublicSection(config, source, type, continuation, currentUserId);
  }

  if (type === "recent") {
    const data = await fetchCollection<{ track?: SoundCloudTrack }>(
      config,
      "/me/play-history/tracks",
      continuation,
      25,
    );
    const items = mapLibraryItems("likes", data.collection ?? [], currentUserId);
    return makeSection(type, items, data.next_href);
  }

  if (type === "tracks") {
    const source = await authenticatedUserSource(config);
    if (!source) return makeSection(type, [], null);
    return loadPublicSection(config, source, type, continuation, currentUserId);
  }

  if (type === "artists") {
    const source = await authenticatedUserSource(config);
    if (!source) return makeSection(type, [], null);
    return loadPublicSection(config, source, type, continuation, currentUserId);
  }

  const data = await fetchCollection(config, "/me/library/all", continuation, 50);
  const items = mapLibraryItems(type, data.collection ?? [], currentUserId);
  return makeSection(type, items, data.next_href);
}

async function fetchCollection<T = SoundCloudTrack | SoundCloudPlaylist | SoundCloudUser | { track?: SoundCloudTrack }>(
  config: SoundCloudConfig,
  endpoint: string,
  continuation?: string,
  limit = 25,
): Promise<SoundCloudCollection<T>> {
  if (continuation) return scFetch(config, continuation);
  return scFetch(config, endpoint, { limit, offset: 0, linked_partitioning: 1 });
}

function endpointFor(source: string, type: LibraryType): string {
  if (type === "tracks") return `/${source}/tracks`;
  if (type === "likes") return `/${source}/track_likes`;
  if (type === "artists") return `/${source}/followings`;
  if (type === "recent") return `/${source}/track_likes`;
  return `/${source}/playlists`;
}

function mapLibraryItems(type: LibraryType, collection: any[], currentUserId?: string | null): HomeItem[] {
  if (type === "albums" || type === "playlists") {
    return collection
      .map((item) => item?.playlist ?? item)
      .filter((item) => item?.kind === "playlist")
      .filter((playlist: SoundCloudPlaylist) => (type === "albums" ? isAlbumSet(playlist) : !isAlbumSet(playlist)))
      .map((item) =>
        type === "playlists"
          ? {
              type: "playlist" as const,
              playlist: playlistToSearchPlaylist(item, currentUserId),
            }
          : resourceToHomeItem(item),
      )
      .filter((item): item is HomeItem => Boolean(item));
  }

  if (type === "likes" || type === "recent") {
    const tracks = collection
      .map((item) => item?.track ?? item)
      .filter((track): track is SoundCloudTrack => track?.kind === "track");
    return playableTracks(tracks)
      .map((track) => resourceToHomeItem(track))
      .filter((item): item is HomeItem => Boolean(item));
  }

  if (type === "tracks") {
    const tracks = collection.filter((track): track is SoundCloudTrack => track?.kind === "track");
    return playableTracks(tracks)
      .map((track) => resourceToHomeItem(track))
      .filter((item): item is HomeItem => Boolean(item));
  }

  return collection
    .filter((user): user is SoundCloudUser => user?.kind === "user")
    .map((user) => resourceToHomeItem(user))
    .filter((item): item is HomeItem => Boolean(item));
}

async function authenticatedUserSource(config: SoundCloudConfig): Promise<string | null> {
  const user = await scFetch<SoundCloudUser>(config, "/me");
  return user.id == null ? null : `users/${user.id}`;
}

function makeSection(type: LibraryType, items: HomeItem[], nextHref?: string | null): HomeSection {
  return {
    id: crypto.randomUUID(),
    title: sectionTitles[type],
    items,
    style: type === "tracks" || type === "likes" || type === "recent" ? "quickPicks" : "cards",
    continuationToken: nextHref ?? undefined,
  };
}

function normalizeType(type: string, authenticated: boolean): LibraryType {
  if (type === "songs") return authenticated ? "likes" : "tracks";
  if (type === "tracks" || type === "uploads") return "tracks";
  if (type === "likes") return "likes";
  if (type === "albums") return "albums";
  if (type === "playlists") return "playlists";
  if (type === "artists" || type === "following") return "artists";
  if (type === "recent" || type === "history") return "recent";
  throw new AddonError(`Unknown SoundCloud library type: ${type}`, 400);
}

function makeFilters(selected?: string, authenticated = false): CatalogFilter[] {
  const filters: Array<[LibraryType | "songs", string]> = [
    ["songs", "Songs"],
    ["tracks", "Uploads"],
    ["playlists", "Playlists"],
    ["albums", "Albums"],
    ["artists", "Following"],
  ];
  if (authenticated) filters.push(["recent", "Recent"]);

  return filters.map(([id, title]) => ({
    id,
    title,
    isSelected: selected === id,
    payload: { providerID: PROVIDER_ID, data: { type: id } },
  }));
}

function filterKeyFor(type: LibraryType): string {
  if (type === "likes") return "songs";
  return type;
}

function emptyPage(): CatalogPage {
  return { sections: [], filters: makeFilters(), quickAccess: null, continuation: null };
}
