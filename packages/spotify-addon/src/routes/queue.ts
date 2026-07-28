import { AddonError } from "@resonance-addons/sdk";
import { transformGraphQLAlbumTrack, transformGraphQLTrackItem } from "../track-mapping";
import type { QueuePage, Track } from "../types";
import { OperationHash, PROVIDER_ID, pf } from "../utils";

const PAGE_LIMIT = 50;

interface QueueToken {
  type: "album" | "playlist" | "radio";
  id: string;
  offset: number;
}

function parseContext(ctx?: any): { type: "album" | "playlist"; id: string } | null {
  if (!ctx) return null;
  const obj =
    typeof ctx === "object"
      ? ctx
      : (() => {
          try {
            return JSON.parse(ctx);
          } catch {
            return null;
          }
        })();
  if (obj && (obj.type === "album" || obj.type === "playlist") && typeof obj.id === "string" && obj.id) {
    return { type: obj.type, id: obj.id };
  }
  return null;
}

function makeToken(type: QueueToken["type"], id: string, offset = 0): QueuePage["continuation"] {
  return { providerID: PROVIDER_ID, token: JSON.stringify({ type, id, offset }) };
}

function radioToken(tracks: Track[]): QueuePage["continuation"] {
  const seed = tracks[tracks.length - 1];
  if (!seed) return null;
  return makeToken("radio", seed.id);
}

function sliceFromTrack(tracks: Track[], trackId: string): Track[] {
  const idx = tracks.findIndex((t) => t.id === trackId);
  return idx >= 0 ? tracks.slice(idx) : tracks;
}

function playlistTrack(item: any): Track | null {
  return transformGraphQLTrackItem(item);
}

async function fetchRecommendations(spDc: string, seedTrackId: string): Promise<Track[]> {
  const data = await pf(spDc, {
    name: "internalLinkRecommenderTrack",
    hash: OperationHash.internalLinkRecommenderTrack,
    variables: { uri: `spotify:track:${seedTrackId}`, limit: 50 },
  });
  const tracks = (data?.seoRecommendedTrack?.items ?? [])
    .map((item: any) => transformGraphQLTrackItem(item))
    .filter((t: Track | null): t is Track => t != null);
  return tracks;
}

async function queueFromAlbum(
  spDc: string,
  albumId: string,
  trackId: string | null,
  offset: number,
  trim: boolean,
): Promise<QueuePage> {
  const data = await pf(spDc, {
    name: "getAlbum",
    hash: OperationHash.getAlbum,
    variables: { uri: `spotify:album:${albumId}`, locale: "", offset, limit: PAGE_LIMIT },
  });

  const albumData = data?.albumUnion;
  if (!albumData?.uri) throw new AddonError("Album not found", 404);

  const rawItems = albumData?.tracksV2?.items ?? [];
  const total = albumData?.tracksV2?.totalCount;
  const mappedTracks = rawItems
    .map((i: any) => transformGraphQLAlbumTrack(i, albumData, albumId))
    .filter((t: Track | null): t is Track => t != null);
  const tracks = mappedTracks;
  const finalTracks = trim && trackId ? sliceFromTrack(tracks, trackId) : tracks;

  const hasMore = typeof total === "number" && offset + rawItems.length < total;
  const continuation = hasMore ? makeToken("album", albumId, offset + rawItems.length) : radioToken(finalTracks);

  return {
    tracks: finalTracks,
    continuation,
    actions: [],
    title: albumData?.name ?? null,
    likeStatus: null,
    playlistId: null,
  };
}

async function queueFromPlaylist(
  spDc: string,
  playlistId: string,
  trackId: string | null,
  offset: number,
  trim: boolean,
): Promise<QueuePage> {
  const data = await pf(spDc, {
    name: "fetchPlaylist",
    hash: OperationHash.fetchPlaylist,
    variables: { uri: `spotify:playlist:${playlistId}`, offset, limit: PAGE_LIMIT, enableWatchFeedEntrypoint: true },
  });

  const playlistData = data?.playlistV2;
  if (!playlistData?.uri) throw new AddonError("Playlist not found", 404);

  const rawItems = playlistData?.content?.items ?? [];
  const total = playlistData?.content?.totalCount;
  const mappedTracks = rawItems.map((i: any) => playlistTrack(i)).filter((t: Track | null): t is Track => t != null);
  const tracks = mappedTracks;
  const finalTracks = trim && trackId ? sliceFromTrack(tracks, trackId) : tracks;

  const hasMore = typeof total === "number" && offset + rawItems.length < total;
  const continuation = hasMore ? makeToken("playlist", playlistId, offset + rawItems.length) : radioToken(finalTracks);

  return {
    tracks: finalTracks,
    continuation,
    actions: [],
    title: playlistData?.name ?? null,
    likeStatus: null,
    playlistId,
  };
}

async function queueFromRadio(spDc: string, seedTrackId: string): Promise<QueuePage> {
  const tracks = await fetchRecommendations(spDc, seedTrackId);
  return {
    tracks,
    continuation: radioToken(tracks),
    actions: [],
    title: null,
    likeStatus: null,
    playlistId: null,
  };
}

export async function handleQueueStart(spDc: string, trackId: string, context?: any): Promise<QueuePage> {
  try {
    const ctx = parseContext(context);
    if (ctx?.type === "album") return queueFromAlbum(spDc, ctx.id, trackId, 0, true);
    if (ctx?.type === "playlist") return queueFromPlaylist(spDc, ctx.id, trackId, 0, true);
    return queueFromRadio(spDc, trackId);
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to start queue", 500);
  }
}

export async function handleQueueMore(spDc: string, token: string): Promise<QueuePage> {
  try {
    const parsed = JSON.parse(token) as Partial<QueueToken>;
    if (typeof parsed.id !== "string" || !parsed.id) throw new AddonError("Invalid queue token", 400);

    if (parsed.type === "radio") {
      return queueFromRadio(spDc, parsed.id);
    }

    if (parsed.type === "album") {
      if (typeof parsed.offset !== "number") throw new AddonError("Invalid queue token", 400);
      return queueFromAlbum(spDc, parsed.id, null, parsed.offset, false);
    }

    if (parsed.type === "playlist") {
      if (typeof parsed.offset !== "number") throw new AddonError("Invalid queue token", 400);
      return queueFromPlaylist(spDc, parsed.id, null, parsed.offset, false);
    }

    throw new AddonError("Unknown queue type", 400);
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to load more queue", 500);
  }
}
