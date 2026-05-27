import { AddonError } from "@resonance-addons/sdk";
import { invalidateResponseCache, ytFetch } from "../auth";

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
    invalidateResponseCache(refreshToken);
    return { success: true };
  } catch (e: any) {
    console.error("Like error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

export async function handleGetLikeStatus(
  refreshToken: string,
  videoId: string,
): Promise<"liked" | "disliked" | "none"> {
  try {
    if (!videoId) throw new AddonError("Missing videoId", 400);

    const data = await ytFetch("next", refreshToken, {
      videoId,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true,
    });
    const items =
      data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer
        ?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents ?? [];

    for (const item of items) {
      const renderer = item?.playlistPanelVideoRenderer;
      if (renderer?.videoId !== videoId) continue;
      const buttons =
        renderer?.menu?.menuRenderer?.items?.[0]?.elementRenderer?.newElement?.type?.componentType?.model?.youtubeModel
          ?.viewModel?.panelHeaderViewModel?.trailingButtons ?? [];
      for (const button of buttons) {
        const toggle =
          button?.elementViewModel?.element?.type?.componentType?.model?.youtubeModel?.viewModel
            ?.likeToggleButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel;
        if (!toggle?.isToggled) continue;
        const onTap = toggle.defaultButtonViewModel?.buttonViewModel?.onTap;
        const commands = onTap?.serialCommand?.commands ?? (onTap?.innertubeCommand ? [onTap] : []);
        for (const command of commands) {
          const status = command?.innertubeCommand?.likeEndpoint?.status;
          if (status === "LIKE") return "liked";
          if (status === "DISLIKE") return "disliked";
        }
      }
      return "none";
    }

    return "none";
  } catch (e: any) {
    console.error("Get like status error:", e.message);
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
    invalidateResponseCache(refreshToken);

    return { success: true };
  } catch (e: any) {
    console.error("Add to playlist error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}
