import { AddonError } from "@resonance-addons/sdk";
import {
  fetchTrack,
  PROVIDER_ID,
  playableTracks,
  resourceToHomeItem,
  type SoundCloudCollection,
  type SoundCloudConfig,
  type SoundCloudTrack,
  scFetch,
  trackToTrack,
} from "../api";
import type { QueuePage, Track } from "../types";
import { handleAlbum, handlePlaylist } from "./detail";
import { handleGetLikeStatus } from "./mutations";

export async function handleQueueStart(config: SoundCloudConfig, trackId: string, context?: any): Promise<QueuePage> {
  try {
    const ctx = parseContext(context);
    let tracks: Track[] = [];
    let title: string | null = null;
    let playlistId: string | null = null;
    let continuationToken: string | null = null;

    if (ctx?.id && (ctx.type === "album" || ctx.type === "playlist")) {
      if (ctx.type === "album") {
        const album = await handleAlbum(config, ctx.id);
        tracks = album.tracks;
        title = album.title;
        playlistId = album.playlistId;
      } else {
        const playlist = await handlePlaylist(config, ctx.id);
        tracks = playlist.entries.map((entry) => entry.track);
        title = playlist.title;
        playlistId = playlist.id;
      }
      tracks = rotateToTrack(tracks, trackId);
    }

    if (!tracks.length) {
      const [seed, related] = await Promise.all([
        fetchTrack(config, trackId),
        scFetch<SoundCloudCollection<SoundCloudTrack>>(config, `/tracks/${encodeURIComponent(trackId)}/related`, {
          limit: 25,
          offset: 0,
          linked_partitioning: 1,
        }).catch(() => ({ collection: [], next_href: null })),
      ]);
      const relatedTracks = playableTracks(related.collection ?? [])
        .map((track) => resourceToHomeItem(track))
        .flatMap((item) => (item?.type === "track" ? [item.track] : []))
        .filter((track) => track.id !== String(seed.id));
      tracks = [trackToTrack(seed), ...relatedTracks];
      title = "Related tracks";
      continuationToken = related.next_href ?? null;
    }

    const likeStatus = await handleGetLikeStatus(config, trackId).catch(() => null);
    return {
      tracks,
      continuation: continuationToken ? { providerID: PROVIDER_ID, token: continuationToken } : null,
      actions: [],
      title,
      likeStatus,
      playlistId,
      relatedBrowseId: trackId,
    };
  } catch (error: any) {
    console.error("[soundcloud:queue] Start error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}

export async function handleQueueMore(config: SoundCloudConfig, token: string): Promise<QueuePage> {
  try {
    const data = await scFetch<SoundCloudCollection<SoundCloudTrack>>(config, token);
    const tracks = playableTracks(data.collection ?? [])
      .map((track) => resourceToHomeItem(track))
      .flatMap((item) => (item?.type === "track" ? [item.track] : []));

    return {
      tracks,
      continuation: data.next_href ? { providerID: PROVIDER_ID, token: data.next_href } : null,
      actions: [],
      title: null,
      likeStatus: null,
    };
  } catch (error: any) {
    console.error("[soundcloud:queue] Continuation error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}

function rotateToTrack(tracks: Track[], trackId: string): Track[] {
  const index = tracks.findIndex((track) => track.id === trackId);
  if (index <= 0) return tracks;
  return [...tracks.slice(index), ...tracks.slice(0, index)];
}

function parseContext(context: any): { id?: string; type?: string } | null {
  if (!context) return null;
  if (typeof context === "object") return context;
  if (typeof context !== "string") return null;

  try {
    return JSON.parse(context);
  } catch {
    try {
      return JSON.parse(atob(context));
    } catch {
      return null;
    }
  }
}
