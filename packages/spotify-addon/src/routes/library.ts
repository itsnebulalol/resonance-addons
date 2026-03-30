import { AddonError } from "@resonance-addons/sdk";
import type { CatalogPage, HomeItem, HomeSection, SearchAlbum, SearchArtist, SearchPlaylist } from "../types";
import { bestImageFromSources, OperationHash, PROVIDER_ID, pf, transformGraphQLTrack, uriToId } from "../utils";

type LibraryType = "playlists" | "songs" | "albums" | "artists";

const LIBRARY_FEATURES = ["LIKED_SONGS", "YOUR_EPISODES_V2", "PRERELEASES", "EVENTS"];

function parseOffset(continuation?: string): number {
  const parsed = Number.parseInt(continuation ?? "0", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function nextOffsetToken(itemCount: number, offset: number, limit: number): string | undefined {
  if (itemCount < limit) return undefined;
  return String(offset + itemCount);
}

function flattenImageSources(items: any[] | undefined): any[] {
  const sources: any[] = [];
  for (const item of items ?? []) {
    sources.push(...(item?.sources ?? []));
  }
  return sources;
}

function mapItems<T>(items: any[] | undefined, mapper: (item: any) => T | null): T[] {
  const mapped: T[] = [];
  for (const item of items ?? []) {
    const value = mapper(item);
    if (value) mapped.push(value);
  }
  return mapped;
}

function makeSection(title: string, items: HomeItem[], continuationToken?: string): HomeSection | null {
  if (items.length === 0) return null;
  return {
    id: `${title.toLowerCase().replace(/\s+/g, "-")}-${Math.random().toString(36).slice(2, 10)}`,
    title,
    items,
    style: "cards",
    continuationToken,
  };
}

function libraryV3Variables(filters: string[], offset: number, limit: number): Record<string, any> {
  return {
    filters,
    limit,
    offset,
    flatten: true,
    expandedFolders: [],
    folderUri: null,
    includeFoldersWhenFlattening: false,
    features: LIBRARY_FEATURES,
    order: null,
    textFilter: "",
  };
}

function playlistItem(entry: any): HomeItem | null {
  const playlistData = entry?.item?.data;
  const uri = playlistData?.uri as string | undefined;
  const name = playlistData?.name as string | undefined;
  if (!uri || !name) return null;

  const playlist: SearchPlaylist = {
    id: uriToId(uri),
    provider: PROVIDER_ID,
    title: name,
    author: playlistData?.ownerV2?.data?.name ?? null,
    trackCount: null,
    thumbnailURL: bestImageFromSources(flattenImageSources(playlistData?.images?.items)),
  };

  return {
    type: "playlist",
    playlist,
  };
}

function albumItem(entry: any): HomeItem | null {
  const albumData = entry?.item?.data;
  const uri = albumData?.uri as string | undefined;
  const name = albumData?.name as string | undefined;
  if (!uri || !name) return null;

  const album: SearchAlbum = {
    id: uriToId(uri),
    provider: PROVIDER_ID,
    title: name,
    artists: (albumData?.artists?.items ?? []).map((artist: any) => ({
      id: artist?.uri ? uriToId(artist.uri) : null,
      name: artist?.profile?.name ?? artist?.name ?? "",
    })),
    year: typeof albumData?.date?.isoString === "string" ? albumData.date.isoString.slice(0, 4) : null,
    thumbnailURL: bestImageFromSources(albumData?.coverArt?.sources ?? []),
    isExplicit: false,
  };

  return {
    type: "album",
    album,
  };
}

function artistItem(entry: any): HomeItem | null {
  const artistData = entry?.item?.data;
  const uri = artistData?.uri as string | undefined;
  const name = artistData?.profile?.name as string | undefined;
  if (!uri || !name) return null;

  const artist: SearchArtist = {
    id: uriToId(uri),
    provider: PROVIDER_ID,
    name,
    thumbnailURL: bestImageFromSources(artistData?.visuals?.avatarImage?.sources ?? []),
    subscriberCount: null,
  };

  return {
    type: "artist",
    artist,
  };
}

function songItem(entry: any): HomeItem | null {
  const trackNode = entry?.track;
  const trackData = trackNode?.data;
  if (!trackData) return null;

  const normalizedTrack = trackData?.uri ? trackData : { ...trackData, uri: trackNode?._uri };
  if (!normalizedTrack?.uri) return null;

  return {
    type: "track",
    track: transformGraphQLTrack(normalizedTrack),
  };
}

async function playlistsSection(spDc: string, continuation?: string): Promise<HomeSection | null> {
  const limit = 50;
  const offset = parseOffset(continuation);
  const data = await pf(spDc, {
    name: "libraryV3",
    hash: OperationHash.libraryV3,
    variables: libraryV3Variables(["Playlists"], offset, limit),
  });

  const rawItems = data?.me?.libraryV3?.items ?? [];
  return makeSection("Playlists", mapItems(rawItems, playlistItem), nextOffsetToken(rawItems.length, offset, limit));
}

async function albumsSection(spDc: string, continuation?: string): Promise<HomeSection | null> {
  const limit = 50;
  const offset = parseOffset(continuation);
  const data = await pf(spDc, {
    name: "libraryV3",
    hash: OperationHash.libraryV3,
    variables: libraryV3Variables(["Albums"], offset, limit),
  });

  const rawItems = data?.me?.libraryV3?.items ?? [];
  return makeSection("Albums", mapItems(rawItems, albumItem), nextOffsetToken(rawItems.length, offset, limit));
}

async function artistsSection(spDc: string, continuation?: string): Promise<HomeSection | null> {
  const limit = 50;
  const offset = parseOffset(continuation);
  const data = await pf(spDc, {
    name: "libraryV3",
    hash: OperationHash.libraryV3,
    variables: libraryV3Variables(["Artists"], offset, limit),
  });

  const rawItems = data?.me?.libraryV3?.items ?? [];
  return makeSection("Artists", mapItems(rawItems, artistItem), nextOffsetToken(rawItems.length, offset, limit));
}

async function songsSection(spDc: string, continuation?: string): Promise<HomeSection | null> {
  const limit = 50;
  const offset = parseOffset(continuation);
  const data = await pf(spDc, {
    name: "fetchLibraryTracks",
    hash: OperationHash.fetchLibraryTracks,
    variables: {
      offset,
      limit,
    },
  });

  const rawItems = data?.me?.library?.tracks?.items ?? [];
  return makeSection("Songs", mapItems(rawItems, songItem), nextOffsetToken(rawItems.length, offset, limit));
}

export async function handleLibrary(spDc: string, type?: string, continuation?: string): Promise<CatalogPage> {
  try {
    let sections: HomeSection[] = [];

    if (type) {
      const loaders: Record<LibraryType, () => Promise<HomeSection | null>> = {
        playlists: () => playlistsSection(spDc, continuation),
        songs: () => songsSection(spDc, continuation),
        albums: () => albumsSection(spDc, continuation),
        artists: () => artistsSection(spDc, continuation),
      };

      if (!(type in loaders)) {
        throw new AddonError(`Invalid library type: ${type}`, 400);
      }

      const section = await loaders[type as LibraryType]();
      sections = section ? [section] : [];
    } else {
      const loaded = await Promise.all([
        playlistsSection(spDc),
        songsSection(spDc),
        albumsSection(spDc),
        artistsSection(spDc),
      ]);
      sections = loaded.filter((section): section is HomeSection => section != null);
    }

    return {
      sections,
      filters: [],
      quickAccess: null,
      continuation: null,
    };
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to load Spotify library", 500);
  }
}
