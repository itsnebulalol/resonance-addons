import { ampGet, ampSend, PROVIDER_ID } from "../api";
import type { SearchPlaylist } from "../models";

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

export async function handleDeletePlaylist(playlistId: string): Promise<void> {
  const response = await ampSend("DELETE", `/v1/me/library/playlists/${playlistId}`);
  if (!response.ok) throw new Error(`deletePlaylist failed: ${response.status}`);
}
