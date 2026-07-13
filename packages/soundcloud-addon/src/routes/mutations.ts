import { AddonError } from "@resonance-addons/sdk";
import {
  fetchPlaylist,
  hasOAuth,
  playlistToSearchPlaylist,
  requireOAuth,
  type SoundCloudCollection,
  type SoundCloudConfig,
  type SoundCloudPlaylist,
  scFetch,
} from "../api";
import type { SearchPlaylist } from "../types";

async function allIds(config: SoundCloudConfig, endpoint: string): Promise<Set<string>> {
  requireOAuth(config);
  const ids = new Set<string>();
  let next: string | null = endpoint;

  while (next) {
    const data: SoundCloudCollection<number> = await scFetch(config, next, { limit: 200, linked_partitioning: 1 });
    for (const id of data.collection ?? []) ids.add(String(id));
    next = data.next_href ?? null;
    if (ids.size > 2000) break;
  }

  return ids;
}

export async function handleGetLikeStatus(config: SoundCloudConfig, trackId: string): Promise<"liked" | "none"> {
  if (!hasOAuth(config)) return "none";

  try {
    const ids = await allIds(config, "/me/track_likes/ids");
    return ids.has(String(trackId)) ? "liked" : "none";
  } catch (error: any) {
    console.error("[soundcloud:mutations] Get like status error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}

export async function handleLike(
  config: SoundCloudConfig,
  _status: "liked" | "disliked" | "none",
  _trackId: string,
): Promise<{ success: true }> {
  requireOAuth(config);
  throw new AddonError(
    "Changing SoundCloud like status is not supported yet: the current web OAuth token exposes like reads, but the live v2 mutation endpoints tested returned 404.",
    501,
  );
}

async function updatePlaylistTracks(
  config: SoundCloudConfig,
  playlist: SoundCloudPlaylist,
  trackIds: string[],
): Promise<SoundCloudPlaylist> {
  requireOAuth(config);
  const id = String(playlist.id ?? "");
  if (!id) throw new AddonError("SoundCloud playlist ID is missing", 400);
  return scFetch<SoundCloudPlaylist>(config, `/playlists/${encodeURIComponent(id)}`, undefined, {
    method: "PUT",
    body: JSON.stringify({
      playlist: {
        title: playlist.title ?? "",
        sharing: "private",
        tracks: trackIds.map(Number),
      },
    }),
  });
}

export async function handleAddToPlaylist(
  config: SoundCloudConfig,
  trackId: string,
  playlistId: string,
): Promise<void> {
  const playlist = await fetchPlaylist(config, playlistId);
  const ids = (playlist.tracks ?? []).map((track) => String(track.id ?? "")).filter(Boolean);
  if (!ids.includes(String(trackId))) ids.push(String(trackId));
  await updatePlaylistTracks(config, playlist, ids);
}

export async function handleCreatePlaylist(config: SoundCloudConfig, name: string): Promise<SearchPlaylist> {
  requireOAuth(config);
  const trimmed = name.trim();
  if (!trimmed) throw new AddonError("Playlist name is required", 400);
  const playlist = await scFetch<SoundCloudPlaylist>(config, "/playlists", undefined, {
    method: "POST",
    body: JSON.stringify({
      playlist: {
        title: trimmed,
        sharing: "private",
        tracks: [],
      },
    }),
  });
  const me = await scFetch<{ id?: string | number }>(config, "/me");
  return {
    ...playlistToSearchPlaylist(playlist, me.id == null ? null : String(me.id)),
    canAddTracks: true,
  };
}

export async function handleRemoveFromPlaylist(
  config: SoundCloudConfig,
  trackId: string,
  playlistId: string,
): Promise<void> {
  const playlist = await fetchPlaylist(config, playlistId);
  const current = (playlist.tracks ?? []).map((track) => String(track.id ?? "")).filter(Boolean);
  const ids = current.filter((id) => id !== String(trackId));
  if (ids.length === current.length) {
    throw new AddonError("Track was not found in this SoundCloud playlist", 404);
  }
  await updatePlaylistTracks(config, playlist, ids);
}

export async function handleDeletePlaylist(config: SoundCloudConfig, playlistId: string): Promise<void> {
  requireOAuth(config);
  await scFetch(config, `/playlists/${encodeURIComponent(playlistId)}`, undefined, {
    method: "DELETE",
  });
}
