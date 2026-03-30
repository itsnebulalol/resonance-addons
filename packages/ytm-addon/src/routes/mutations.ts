import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";

export async function handleLike(
  refreshToken: string,
  body: { videoId: string; status: "liked" | "disliked" | "none" },
): Promise<{ success: true }> {
  try {
    const { videoId, status } = body;
    if (!videoId) throw new AddonError("Missing videoId", 400);

    const endpointMap: Record<string, string> = {
      liked: "like/like",
      disliked: "like/dislike",
      none: "like/removelike",
    };

    const endpoint = endpointMap[status];
    if (!endpoint) throw new AddonError("Invalid status", 400);

    await ytFetch(endpoint, refreshToken, { target: { videoId } });
    return { success: true };
  } catch (e: any) {
    console.error("Like error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

export async function handleAddToPlaylist(
  refreshToken: string,
  body: { videoId: string; playlistId: string },
): Promise<{ success: true }> {
  try {
    const { videoId, playlistId: rawPlaylistId } = body;
    if (!videoId || !rawPlaylistId) {
      throw new AddonError("Missing videoId or playlistId", 400);
    }

    const playlistId = rawPlaylistId.startsWith("VL") ? rawPlaylistId.slice(2) : rawPlaylistId;

    await ytFetch("browse/edit_playlist", refreshToken, {
      playlistId,
      actions: [{ action: "ACTION_ADD_VIDEO", addedVideoId: videoId }],
    });

    return { success: true };
  } catch (e: any) {
    console.error("Add to playlist error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}
