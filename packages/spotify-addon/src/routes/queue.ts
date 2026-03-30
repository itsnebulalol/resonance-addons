import { AddonError } from "@resonance-addons/sdk";
import type { QueuePage, Track } from "../types";
import { bestImageFromSources, OperationHash, PROVIDER_ID, pf, transformGraphQLTrack, uriToId } from "../utils";

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

function albumTrack(trackEntry: any, albumData: any, fallbackAlbumId: string): Track | null {
  const rawTrack = trackEntry?.track ?? trackEntry;
  if (!rawTrack?.uri || !String(rawTrack.uri).startsWith("spotify:track:")) return null;

  const normalized = rawTrack.albumOfTrack
    ? rawTrack
    : {
        ...rawTrack,
        albumOfTrack: {
          uri: albumData?.uri ?? `spotify:album:${fallbackAlbumId}`,
          name: albumData?.name ?? "",
          coverArt: albumData?.coverArt ?? null,
        },
      };

  const mapped = transformGraphQLTrack(normalized);
  const albumUri = (albumData?.uri as string) ?? `spotify:album:${fallbackAlbumId}`;

  return {
    ...mapped,
    album: { id: uriToId(albumUri), name: albumData?.name ?? mapped.album?.name ?? "" },
    thumbnailURL: mapped.thumbnailURL ?? bestImageFromSources(albumData?.coverArt?.sources ?? []),
  };
}

function playlistTrack(item: any): Track | null {
  const trackData = item?.itemV2?.data;
  if (!trackData?.uri || !String(trackData.uri).startsWith("spotify:track:")) return null;
  return transformGraphQLTrack(trackData);
}

async function fetchRecommendations(spDc: string, seedTrackId: string): Promise<Track[]> {
  const data = await pf(spDc, {
    name: "internalLinkRecommenderTrack",
    hash: OperationHash.internalLinkRecommenderTrack,
    variables: { uri: `spotify:track:${seedTrackId}`, limit: 50 },
  });
  return (data?.seoRecommendedTrack?.items ?? [])
    .map((item: any) => {
      const td = item?.data;
      return td?.uri ? transformGraphQLTrack(td) : null;
    })
    .filter((t: Track | null): t is Track => t != null);
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
  const tracks = rawItems
    .map((i: any) => albumTrack(i, albumData, albumId))
    .filter((t: Track | null): t is Track => t != null);
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
  const tracks = rawItems.map((i: any) => playlistTrack(i)).filter((t: Track | null): t is Track => t != null);
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
