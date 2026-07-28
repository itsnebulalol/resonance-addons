import { AddonError, playlistRevision } from "@resonance-addons/sdk";
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
import type { PlaylistDetail, PlaylistEntry, PlaylistUpdateRequest, SearchPlaylist } from "../types";
import { handlePlaylist } from "./detail";

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
  status: "liked" | "disliked" | "none",
  trackId: string,
): Promise<{ success: true }> {
  requireOAuth(config);
  const user = await scFetch<{ id?: string | number }>(config, "/me");
  if (user.id == null) {
    throw new AddonError("SoundCloud user ID is unavailable", 404);
  }
  try {
    await scFetch(
      config,
      `/users/${encodeURIComponent(String(user.id))}/track_likes/${encodeURIComponent(String(trackId))}`,
      undefined,
      { method: status === "liked" ? "PUT" : "DELETE" },
    );
    return { success: true };
  } catch (error: any) {
    if (error instanceof AddonError && error.status === 403 && !config.datadome?.trim()) {
      throw new AddonError(
        "SoundCloud blocked the like request. Add the current datadome cookie in SoundCloud provider settings.",
        403,
      );
    }
    throw error;
  }
}

export async function handleFavoriteCollection(): Promise<SearchPlaylist> {
  return {
    id: "__likes__",
    provider: "net.itsnebula.soundcloud",
    title: "Likes",
    author: null,
    trackCount: null,
    thumbnailURL: null,
    canAddTracks: false,
    canDelete: false,
  };
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
    canDelete: true,
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

function playlistEntries(playlist: SoundCloudPlaylist): PlaylistEntry[] {
  return (playlist.tracks ?? []).flatMap((track) => {
    if (track.id == null) return [];
    const id = String(track.id);
    return [
      {
        id: String(track.urn ?? id),
        track: {
          id,
          provider: "net.itsnebula.soundcloud",
          title: track.title ?? "",
          artists: track.user?.username
            ? [{ id: track.user.id == null ? null : String(track.user.id), name: track.user.username }]
            : [],
          album: null,
          duration: null,
          durationSeconds: track.duration ? Math.round(track.duration / 1000) : null,
          thumbnailURL: track.artwork_url ?? null,
          isExplicit: track.publisher_metadata?.explicit === true,
        },
      },
    ];
  });
}

export async function handleRemovePlaylistEntry(
  config: SoundCloudConfig,
  entryId: string,
  _trackId: string,
  playlistId: string,
): Promise<void> {
  const playlist = await fetchPlaylist(config, playlistId);
  const tracks = playlist.tracks ?? [];
  const index = tracks.findIndex((track) => String(track.urn ?? track.id ?? "") === entryId);
  if (index < 0) throw new AddonError("Playlist entry was not found.", 404);
  tracks.splice(index, 1);
  await updatePlaylistTracks(
    config,
    playlist,
    tracks.map((track) => String(track.id)),
  );
}

export async function handleUpdatePlaylist(
  config: SoundCloudConfig,
  request: PlaylistUpdateRequest,
): Promise<PlaylistDetail> {
  const playlist = await fetchPlaylist(config, request.playlistID);
  const currentEntries = playlistEntries(playlist);
  const currentRevision = `${playlist.last_modified ?? ""}:${playlistRevision(playlist.title ?? "", currentEntries)}`;
  if (request.revision && currentRevision !== request.revision) {
    throw new AddonError("The playlist changed on another device. Reload it and try again.", 409);
  }
  if (playlist.track_count != null && playlist.track_count !== (playlist.tracks?.length ?? 0)) {
    throw new AddonError("SoundCloud returned an incomplete playlist. Reload it before editing.", 409);
  }
  if (request.artwork) {
    throw new AddonError("SoundCloud playlist artwork editing requires official OAuth access.", 400);
  }
  await scFetch(config, `/playlists/${encodeURIComponent(request.playlistID)}`, undefined, {
    method: "PUT",
    body: JSON.stringify({
      playlist: {
        title: request.name,
        tracks: request.entries.map((entry) => Number(entry.track.id)),
      },
    }),
  });
  return handlePlaylist(config, request.playlistID);
}

export async function handleDeletePlaylist(config: SoundCloudConfig, playlistId: string): Promise<void> {
  requireOAuth(config);
  await scFetch(config, `/playlists/${encodeURIComponent(playlistId)}`, undefined, {
    method: "DELETE",
  });
}
