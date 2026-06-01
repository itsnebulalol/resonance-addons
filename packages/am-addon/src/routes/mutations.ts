import { ampSend } from "../amapi";

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
