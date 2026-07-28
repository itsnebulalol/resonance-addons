import { AddonError, playlistRevision } from "@resonance-addons/sdk";
import { transformGraphQLTrackItem } from "../track-mapping";
import type { PlaylistDetail, PlaylistEntry, PlaylistEntryPage, Track } from "../types";
import { bestImageFromSources, OperationHash, pf, uriToId } from "../utils";

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

function playlistEntry(item: any): PlaylistEntry | null {
  const track = transformGraphQLTrackItem(item);
  const id = item?.uid;
  return track && id ? { id: String(id), track } : null;
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
  const mappedTracks = (tracksData?.items ?? [])
    .map((item: any) => transformGraphQLTrackItem(item))
    .filter((t: Track | null): t is Track => t != null);
  return { tracks: mappedTracks, totalCount };
}

const LIKED_SONGS_IDS = new Set(["tracks", "collection:tracks", "your-episodes"]);

export async function handlePlaylist(spDc: string, playlistId: string): Promise<PlaylistDetail> {
  try {
    if (LIKED_SONGS_IDS.has(playlistId)) {
      const { tracks, totalCount } = await fetchLikedSongs(spDc, 0);
      const entries = tracks.map((track, index) => ({ id: `liked:${index}:${track.id}`, track }));
      return {
        id: "tracks",
        title: "Liked Songs",
        author: null,
        description: null,
        trackCount: `${totalCount} songs`,
        thumbnailURL: "https://misc.scdn.co/liked-songs/liked-songs-640.png",
        entries,
        continuation: tracks.length < totalCount ? String(tracks.length) : null,
        revision: playlistRevision("Liked Songs", entries),
        editCapabilities: {
          canRename: false,
          canChangeArtwork: false,
          canReorder: false,
          canRemoveItems: false,
        },
      };
    }

    const data = await fetchPlaylistPage(spDc, playlistId, 0);
    const playlistData = data?.playlistV2;
    if (!playlistData?.uri) {
      throw new AddonError("Playlist not found", 404);
    }

    const rawItems = playlistData?.content?.items ?? [];
    const entries = rawItems
      .map((item: any) => playlistEntry(item))
      .filter((entry: PlaylistEntry | null): entry is PlaylistEntry => entry != null);
    const editable = playlistData?.currentUserCapabilities?.canEditItems === true;

    return {
      id: uriToId(playlistData.uri),
      title: playlistData?.name ?? "",
      author: playlistData?.ownerV2?.data?.name ?? null,
      description: typeof playlistData?.description === "string" ? playlistData.description : null,
      trackCount:
        typeof playlistData?.content?.totalCount === "number"
          ? `${playlistData.content.totalCount} songs`
          : entries.length > 0
            ? `${entries.length} songs`
            : null,
      thumbnailURL: bestImageFromSources(flattenImageSources(playlistData?.images?.items)),
      entries,
      continuation: nextContinuation(playlistData?.content?.totalCount, 0, rawItems.length),
      revision: playlistRevision(playlistData?.name ?? "", entries),
      editCapabilities: editable
        ? {
            canRename: false,
            canChangeArtwork: true,
            canReorder: true,
            canRemoveItems: true,
          }
        : {
            canRename: false,
            canChangeArtwork: false,
            canReorder: false,
            canRemoveItems: false,
          },
    };
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to load playlist", 500);
  }
}

export async function handlePlaylistMore(
  spDc: string,
  playlistId: string,
  continuation: string,
): Promise<PlaylistEntryPage> {
  try {
    const offset = parseOffset(continuation);

    if (LIKED_SONGS_IDS.has(playlistId)) {
      const { tracks, totalCount } = await fetchLikedSongs(spDc, offset);
      return {
        entries: tracks.map((track, index) => ({
          id: `liked:${offset + index}:${track.id}`,
          track,
        })),
        continuation: offset + tracks.length < totalCount ? String(offset + tracks.length) : null,
      };
    }

    const data = await fetchPlaylistPage(spDc, playlistId, offset);
    const playlistData = data?.playlistV2;
    const rawItems = playlistData?.content?.items ?? [];
    const entries = rawItems
      .map((item: any) => playlistEntry(item))
      .filter((entry: PlaylistEntry | null): entry is PlaylistEntry => entry != null);

    return {
      entries,
      continuation: nextContinuation(playlistData?.content?.totalCount, offset, rawItems.length),
    };
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to load playlist continuation", 500);
  }
}
