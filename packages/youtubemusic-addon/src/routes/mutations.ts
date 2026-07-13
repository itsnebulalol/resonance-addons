import { AddonError } from "@resonance-addons/sdk";
import { invalidateResponseCache, ytFetch } from "../auth";
import type { SearchPlaylist, YouTubeMusicConfig } from "../types";
import { PROVIDER_ID } from "../utils";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findSetVideoId(value: any, videoId: string): string | null {
  if (value == null || typeof value !== "object") return null;
  if (typeof value.setVideoId === "string" && String(value.removedVideoId ?? "") === videoId) {
    return value.setVideoId;
  }
  for (const child of Object.values(value)) {
    const found = findSetVideoId(child, videoId);
    if (found) return found;
  }
  return null;
}

export async function handleLike(
  config: YouTubeMusicConfig,
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

    await ytFetch(endpoint, config, { target: { videoId } });
    invalidateResponseCache(config.refreshToken);
    return { success: true };
  } catch (e: any) {
    console.error("Like error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

export async function handleGetLikeStatus(
  config: YouTubeMusicConfig,
  videoId: string,
): Promise<"liked" | "disliked" | "none"> {
  try {
    if (!videoId) throw new AddonError("Missing videoId", 400);

    const data = await ytFetch("next", config, {
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
  config: YouTubeMusicConfig,
  body: { videoId: string; playlistId: string },
): Promise<{ success: true }> {
  try {
    const { videoId, playlistId: rawPlaylistId } = body;
    if (!videoId || !rawPlaylistId) {
      throw new AddonError("Missing videoId or playlistId", 400);
    }

    const playlistId = rawPlaylistId.startsWith("VL") ? rawPlaylistId.slice(2) : rawPlaylistId;

    let lastError: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await ytFetch("browse/edit_playlist", config, {
          playlistId,
          actions: [
            {
              action: "ACTION_ADD_VIDEO",
              addedVideoId: videoId,
              dedupeOption: "DEDUPE_OPTION_SKIP",
            },
          ],
        });
        lastError = null;
        break;
      } catch (error: any) {
        lastError = error;
        if (!String(error?.message ?? error).includes("(409)") || attempt === 2) throw error;
        await sleep(500 * 2 ** attempt);
        invalidateResponseCache(config.refreshToken);
      }
    }
    if (lastError) throw lastError;
    invalidateResponseCache(config.refreshToken);

    return { success: true };
  } catch (e: any) {
    console.error("Add to playlist error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

export async function handleCreatePlaylist(config: YouTubeMusicConfig, name: string): Promise<SearchPlaylist> {
  const trimmed = name.trim();
  if (!trimmed) throw new AddonError("Playlist name is required", 400);
  const response = await ytFetch("playlist/create", config, {
    title: trimmed,
    description: "",
    privacyStatus: "PRIVATE",
  });
  const playlistId = response?.playlistId;
  if (!playlistId) throw new AddonError("YouTube Music did not return a playlist ID", 500);
  invalidateResponseCache(config.refreshToken);
  return {
    id: playlistId,
    provider: PROVIDER_ID,
    title: trimmed,
    author: null,
    trackCount: "0 songs",
    thumbnailURL: null,
    canAddTracks: true,
  };
}

export async function handleRemoveFromPlaylist(
  config: YouTubeMusicConfig,
  trackId: string,
  rawPlaylistId: string,
): Promise<void> {
  const playlistId = rawPlaylistId.startsWith("VL") ? rawPlaylistId.slice(2) : rawPlaylistId;
  const response = await ytFetch("browse", config, {
    browseId: `VL${playlistId}`,
  });
  const setVideoId = findSetVideoId(response, trackId);
  if (!setVideoId) {
    throw new AddonError("Track was not found in this editable YouTube Music playlist", 404);
  }
  await ytFetch("browse/edit_playlist", config, {
    playlistId,
    actions: [
      {
        action: "ACTION_REMOVE_VIDEO",
        removedVideoId: trackId,
        setVideoId,
      },
    ],
  });
  invalidateResponseCache(config.refreshToken);
}

export async function handleDeletePlaylist(config: YouTubeMusicConfig, rawPlaylistId: string): Promise<void> {
  const playlistId = rawPlaylistId.startsWith("VL") ? rawPlaylistId.slice(2) : rawPlaylistId;
  await ytFetch("playlist/delete", config, { playlistId });
  invalidateResponseCache(config.refreshToken);
}
