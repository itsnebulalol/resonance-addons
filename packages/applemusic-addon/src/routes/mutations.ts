import { AddonError } from "@resonance-addons/sdk";
import { ampGet, ampSend, PROVIDER_ID } from "../api";
import type { PlaylistDetail, PlaylistEntry, PlaylistUpdateRequest, SearchPlaylist } from "../models";
import { handlePlaylist } from "./detail";

export async function handleGetLikeStatus(trackId: string): Promise<"liked" | "disliked" | "none"> {
  const r = await ampSend("GET", `/v1/me/ratings/songs/${trackId}`);
  if (!r.ok) return "none"; // 404 = unrated
  const v = r.json?.data?.[0]?.attributes?.value;
  return v === 1 ? "liked" : v === -1 ? "disliked" : "none";
}

export async function handleLike(status: "liked" | "disliked" | "none", trackId: string): Promise<void> {
  if (status === "none") {
    await ampSend("DELETE", `/v1/me/ratings/songs/${trackId}`);
    return;
  }
  const value = status === "liked" ? 1 : -1;
  const r = await ampSend("PUT", `/v1/me/ratings/songs/${trackId}`, { type: "rating", attributes: { value } });
  if (!r.ok) throw new Error(`set rating failed: ${r.status}`);
}

export async function handleAddToPlaylist(trackId: string, playlistId: string): Promise<void> {
  const r = await ampSend("POST", `/v1/me/library/playlists/${playlistId}/tracks`, {
    data: [{ id: trackId, type: "songs" }],
  });
  if (!r.ok) throw new Error(`addToPlaylist failed: ${r.status}`);
}

export async function handleCreatePlaylist(name: string): Promise<SearchPlaylist> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Playlist name is required");
  const response = await ampSend("POST", "/v1/me/library/playlists", {
    attributes: {
      name: trimmed,
      description: "",
      isPublic: false,
    },
  });
  const playlist = response.json?.data?.[0];
  if (!response.ok || !playlist?.id) {
    throw new Error(`createPlaylist failed: ${response.status}`);
  }
  return {
    id: String(playlist.id),
    provider: PROVIDER_ID,
    title: playlist.attributes?.name ?? trimmed,
    author: null,
    trackCount: "0 songs",
    thumbnailURL: null,
    canAddTracks: true,
    canDelete: true,
  };
}

export async function handleRemoveFromPlaylist(trackId: string, playlistId: string): Promise<void> {
  let path: string | null = `/v1/me/library/playlists/${playlistId}/tracks`;
  let librarySongId: string | null = null;
  while (path && !librarySongId) {
    const page = await ampGet(path, { limit: 100 });
    const match = (page?.data ?? []).find(
      (item: any) =>
        String(item?.attributes?.playParams?.catalogId ?? "") === String(trackId) ||
        String(item?.id ?? "") === String(trackId),
    );
    if (match?.id) librarySongId = String(match.id);
    path = page?.next ?? null;
  }
  if (!librarySongId) throw new Error("Track was not found in this Apple Music playlist");
  const response = await ampSend(
    "DELETE",
    `/v1/me/library/playlists/${playlistId}/tracks?ids[library-songs]=${encodeURIComponent(librarySongId)}&mode=all`,
  );
  if (!response.ok) throw new Error(`removeFromPlaylist failed: ${response.status}`);
}

function resourceID(entryID: string): string {
  return entryID.split("@", 1)[0]!;
}

async function allPlaylistEntries(playlistId: string): Promise<PlaylistEntry[]> {
  const entries: PlaylistEntry[] = [];
  let path: string | null = `/v1/me/library/playlists/${playlistId}/tracks?limit=100&omit%5Bresource%5D=autos`;
  let offset = 0;
  while (path) {
    const page = await ampGet(path);
    for (const item of page?.data ?? []) {
      entries.push({
        id: `${String(item.id)}@${offset++}`,
        track: {
          id: String(item?.attributes?.playParams?.catalogId ?? item.id),
          provider: PROVIDER_ID,
          title: item?.attributes?.name ?? "",
          artists: item?.attributes?.artistName ? [{ id: null, name: item.attributes.artistName }] : [],
          album: item?.attributes?.albumName ? { id: null, name: item.attributes.albumName } : null,
          duration: null,
          durationSeconds: null,
          thumbnailURL: null,
          isExplicit: item?.attributes?.contentRating === "explicit",
        },
      });
    }
    path = page?.next ?? null;
  }
  return entries;
}

export async function handleRemovePlaylistEntry(entryId: string, _trackId: string, playlistId: string): Promise<void> {
  const current = await allPlaylistEntries(playlistId);
  const index = current.findIndex((entry) => entry.id === entryId);
  if (index < 0) throw new AddonError("Playlist entry was not found.", 404);
  current.splice(index, 1);
  const response = await ampSend("PUT", `/v1/me/library/playlists/${playlistId}/tracks`, {
    data: current.map((entry) => ({ id: resourceID(entry.id), type: "library-songs" })),
  });
  if (!response.ok) throw new AddonError(`removeFromPlaylist failed: ${response.status}`, response.status);
}

export async function handleUpdatePlaylist(request: PlaylistUpdateRequest): Promise<PlaylistDetail> {
  const currentDetail = await handlePlaylist(request.playlistID);
  if (request.revision && currentDetail.revision !== request.revision) {
    throw new AddonError("The playlist changed on another device. Reload it and try again.", 409);
  }
  if (request.artwork) {
    throw new AddonError("Apple Music playlist artwork editing is unavailable through MusicKit.", 400);
  }
  const tracksResponse = await ampSend("PUT", `/v1/me/library/playlists/${request.playlistID}/tracks`, {
    data: request.entries.map((entry) => ({
      id: resourceID(entry.id),
      type: "library-songs",
    })),
  });
  if (!tracksResponse.ok) {
    throw new AddonError(`updatePlaylist tracks failed: ${tracksResponse.status}`, tracksResponse.status);
  }
  if (request.name !== currentDetail.title) {
    const metadataResponse = await ampSend("PATCH", `/v1/me/library/playlists/${request.playlistID}`, {
      attributes: {
        name: request.name,
        description: currentDetail.description ?? "",
        isPublic: false,
      },
    });
    if (!metadataResponse.ok) {
      throw new AddonError(`updatePlaylist name failed: ${metadataResponse.status}`, metadataResponse.status);
    }
  }
  return handlePlaylist(request.playlistID);
}

export async function handleDeletePlaylist(playlistId: string): Promise<void> {
  const response = await ampSend("DELETE", `/v1/me/library/playlists/${playlistId}`);
  if (!response.ok) throw new Error(`deletePlaylist failed: ${response.status}`);
}
