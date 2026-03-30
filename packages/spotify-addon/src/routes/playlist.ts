import { AddonError } from "@resonance-addons/sdk";
import type { PlaylistDetail, Track, TrackPage } from "../types";
import { bestImageFromSources, OperationHash, pf, transformGraphQLTrack, uriToId } from "../utils";

function parseOffset(continuation?: string): number {
  const parsed = Number.parseInt(continuation ?? "0", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function flattenImageSources(items: any[] | undefined): any[] {
  const sources: any[] = [];
  for (const item of items ?? []) {
    sources.push(...(item?.sources ?? []));
  }
  return sources;
}

function playlistTrack(item: any): Track | null {
  const trackData = item?.itemV2?.data;
  if (!trackData?.uri || !String(trackData.uri).startsWith("spotify:track:")) return null;
  return transformGraphQLTrack(trackData);
}

function nextContinuation(totalCount: number | undefined, offset: number, rawItemCount: number): string | null {
  if (typeof totalCount !== "number") return rawItemCount > 0 ? String(offset + rawItemCount) : null;
  if (offset + rawItemCount >= totalCount) return null;
  return String(offset + rawItemCount);
}

async function fetchPlaylistPage(spDc: string, playlistId: string, offset: number): Promise<any> {
  return pf(spDc, {
    name: "fetchPlaylist",
    hash: OperationHash.fetchPlaylist,
    variables: {
      uri: `spotify:playlist:${playlistId}`,
      offset,
      limit: 50,
      enableWatchFeedEntrypoint: true,
    },
  });
}

async function fetchLikedSongs(spDc: string, offset: number): Promise<{ tracks: Track[]; totalCount: number }> {
  const data = await pf(spDc, {
    name: "fetchLibraryTracks",
    hash: OperationHash.fetchLibraryTracks,
    variables: { offset, limit: 50 },
  });
  const tracksData = data?.me?.library?.tracks;
  const totalCount = tracksData?.totalCount ?? 0;
  const tracks = (tracksData?.items ?? [])
    .map((item: any) => {
      const trackNode = item?.track;
      const trackData = trackNode?.data;
      if (!trackData) return null;
      const normalized = trackData.uri ? trackData : { ...trackData, uri: trackNode?._uri };
      if (!normalized?.uri) return null;
      return transformGraphQLTrack(normalized);
    })
    .filter((t: Track | null): t is Track => t != null);
  return { tracks, totalCount };
}

const LIKED_SONGS_IDS = new Set(["tracks", "collection:tracks", "your-episodes"]);

export async function handlePlaylist(spDc: string, playlistId: string): Promise<PlaylistDetail> {
  try {
    if (LIKED_SONGS_IDS.has(playlistId)) {
      const { tracks, totalCount } = await fetchLikedSongs(spDc, 0);
      return {
        id: "tracks",
        title: "Liked Songs",
        author: null,
        description: null,
        trackCount: `${totalCount} songs`,
        thumbnailURL: "https://misc.scdn.co/liked-songs/liked-songs-640.png",
        tracks,
        continuation: tracks.length < totalCount ? String(tracks.length) : null,
      };
    }

    const data = await fetchPlaylistPage(spDc, playlistId, 0);
    const playlistData = data?.playlistV2;
    if (!playlistData?.uri) {
      throw new AddonError("Playlist not found", 404);
    }

    const rawItems = playlistData?.content?.items ?? [];
    const tracks = rawItems
      .map((item: any) => playlistTrack(item))
      .filter((track: Track | null): track is Track => track != null);

    return {
      id: uriToId(playlistData.uri),
      title: playlistData?.name ?? "",
      author: playlistData?.ownerV2?.data?.name ?? null,
      description: typeof playlistData?.description === "string" ? playlistData.description : null,
      trackCount:
        typeof playlistData?.content?.totalCount === "number"
          ? `${playlistData.content.totalCount} songs`
          : tracks.length > 0
            ? `${tracks.length} songs`
            : null,
      thumbnailURL: bestImageFromSources(flattenImageSources(playlistData?.images?.items)),
      tracks,
      continuation: nextContinuation(playlistData?.content?.totalCount, 0, rawItems.length),
    };
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to load playlist", 500);
  }
}

export async function handlePlaylistMore(spDc: string, playlistId: string, continuation: string): Promise<TrackPage> {
  try {
    const offset = parseOffset(continuation);

    if (LIKED_SONGS_IDS.has(playlistId)) {
      const { tracks, totalCount } = await fetchLikedSongs(spDc, offset);
      return {
        tracks,
        continuation: offset + tracks.length < totalCount ? String(offset + tracks.length) : null,
      };
    }

    const data = await fetchPlaylistPage(spDc, playlistId, offset);
    const playlistData = data?.playlistV2;
    const rawItems = playlistData?.content?.items ?? [];
    const tracks = rawItems
      .map((item: any) => playlistTrack(item))
      .filter((track: Track | null): track is Track => track != null);

    return {
      tracks,
      continuation: nextContinuation(playlistData?.content?.totalCount, offset, rawItems.length),
    };
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to load playlist continuation", 500);
  }
}
