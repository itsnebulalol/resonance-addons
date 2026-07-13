import { ampGet, getStorefront, PROVIDER_ID, radioNextTracks, songStationId, songToTrack } from "../api";
import type { QueuePage, Track } from "../models";
import { handleAlbum, handlePlaylist } from "./detail";
import { handleGetLikeStatus } from "./mutations";

function parseContext(context: any): { id?: string; type?: string } | null {
  if (!context) return null;
  try {
    return typeof context === "string" ? JSON.parse(context) : context;
  } catch {
    return null;
  }
}

// startQueue: play a track and build the surrounding queue.
//  - tapped from an album/playlist (context) -> that collection, seed track first
//  - tapped standalone -> Apple's real song radio (ra.cp-{songId} continuous station)
export async function handleQueueStart(trackId: string, context?: any): Promise<QueuePage> {
  const sf = await getStorefront();
  const station = songStationId(trackId);

  let seed: Track | null = null;
  let artistId: string | null = null;
  try {
    const sd = await ampGet(`/v1/catalog/${sf}/songs/${trackId}`, { include: "artists" });
    const s = sd?.data?.[0];
    if (s) {
      seed = songToTrack(s);
      artistId = s.relationships?.artists?.data?.[0]?.id ?? null;
    }
  } catch (e: any) {
    console.error("[queue] seed song failed:", e.message);
  }

  const ctx = parseContext(context);
  let tracks: Track[] = [];
  let title: string | null = null;
  let playlistId: string | null = null;
  try {
    if (ctx?.type === "album" && ctx.id) {
      const a = await handleAlbum(ctx.id);
      tracks = a.tracks;
      title = a.title;
    } else if (ctx?.type === "playlist" && ctx.id) {
      const p = await handlePlaylist(ctx.id);
      tracks = p.tracks;
      title = p.title;
      playlistId = ctx.id;
    }
  } catch (e: any) {
    console.error("[queue] context load failed:", e.message);
  }

  let isRadio = false;
  if (tracks.length) {
    // album/playlist: rotate so the tapped track plays first
    const idx = tracks.findIndex((t) => t.id === trackId);
    if (idx > 0) tracks = [...tracks.slice(idx), ...tracks.slice(0, idx)];
  } else {
    // standalone song -> Apple's real song radio
    isRadio = true;
    let radio = (await radioNextTracks(station, 10)).filter((t) => t.id !== trackId);
    if (radio.length === 0 && artistId) {
      try {
        const d = await ampGet(`/v1/catalog/${sf}/artists/${artistId}/view/top-songs`, { limit: 25 });
        radio = (d?.data ?? []).map(songToTrack).filter((t: Track) => t.id !== trackId);
      } catch (e: any) {
        console.error("[queue] radio fallback failed:", e.message);
      }
    }
    tracks = seed ? [seed, ...radio] : radio;
    title = title ?? "Station";
  }

  const likeStatus = await handleGetLikeStatus(trackId).catch(() => null);
  const continuation = isRadio && tracks.length ? { providerID: PROVIDER_ID, token: station } : null;
  console.log(`[queue] start ${trackId}: ${tracks.length} tracks (radio=${isRadio})`);
  return { tracks, continuation, actions: [], title, likeStatus, playlistId, relatedBrowseId: station };
}

// loadMore: pull the next batch from the radio station (fresh every call -> endless).
export async function handleQueueMore(token: string): Promise<QueuePage> {
  const tracks = await radioNextTracks(token, 10);
  return {
    tracks,
    continuation: tracks.length ? { providerID: PROVIDER_ID, token } : null,
    actions: [],
    title: null,
    likeStatus: null,
  };
}
