import { AddonError } from "@resonance-addons/sdk";
import { invalidateResponseCache, mintAccessToken, youtubeMusicClientHeaders, ytFetch } from "../auth";
import type {
  PlaylistDetail,
  PlaylistEntry,
  PlaylistUpdateRequest,
  SearchPlaylist,
  YouTubeMusicConfig,
} from "../types";
import { PROVIDER_ID } from "../utils";
import { handlePlaylist, handlePlaylistMore } from "./playlist";

const PLAYLIST_IMAGE_UPLOAD_URL = "https://music.youtube.com/playlist_image_upload/playlist_custom_thumbnail";
const MAX_PLAYLIST_ARTWORK_BYTES = 2 * 1024 * 1024;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function playlistArtworkBytes(dataBase64: string, mimeType: string): Buffer {
  const normalizedMIMEType = mimeType.trim().toLowerCase();
  if (normalizedMIMEType !== "image/jpeg" && normalizedMIMEType !== "image/png") {
    throw new AddonError("YouTube Music playlist artwork must be JPEG or PNG.", 400);
  }
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.length === 0) {
    throw new AddonError("Playlist artwork is empty.", 400);
  }
  if (bytes.length > MAX_PLAYLIST_ARTWORK_BYTES) {
    throw new AddonError("YouTube Music playlist artwork must be 2 MB or smaller.", 400);
  }
  return bytes;
}

export function playlistArtworkAction(encryptedBlobId: string): Record<string, unknown> {
  return {
    action: "ACTION_SET_CUSTOM_THUMBNAIL",
    addedCustomThumbnail: {
      imageKey: {
        name: "studio_square_thumbnail",
        type: "PLAYLIST_IMAGE_TYPE_CUSTOM_THUMBNAIL",
      },
      playlistScottyEncryptedBlobId: encryptedBlobId,
    },
  };
}

async function playlistArtworkRequest(
  accessToken: string,
  url: string,
  init: RequestInit,
  operation: string,
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Origin: "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
      ...youtubeMusicClientHeaders(),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new AddonError(
      `YouTube Music playlist artwork ${operation} failed (${response.status}): ${text.slice(0, 300)}`,
      response.status,
    );
  }
  return response;
}

async function uploadPlaylistArtwork(
  config: YouTubeMusicConfig,
  playlistId: string,
  artwork: NonNullable<PlaylistUpdateRequest["artwork"]>,
): Promise<void> {
  const mimeType = artwork.mimeType.trim().toLowerCase();
  const bytes = playlistArtworkBytes(artwork.data, mimeType);
  const accessToken = await mintAccessToken(config.refreshToken);
  const startResponse = await playlistArtworkRequest(
    accessToken,
    PLAYLIST_IMAGE_UPLOAD_URL,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      },
    },
    "session start",
  );
  const uploadURL = startResponse.headers.get("x-goog-upload-url");
  if (!uploadURL) {
    throw new AddonError("YouTube Music did not return a playlist artwork upload URL.", 500);
  }

  const uploadResponse = await playlistArtworkRequest(
    accessToken,
    uploadURL,
    {
      method: "POST",
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(bytes.length),
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
      },
      body: bytes,
    },
    "upload",
  );
  const uploadData = (await uploadResponse.json()) as { encryptedBlobId?: string };
  if (!uploadData.encryptedBlobId) {
    throw new AddonError("YouTube Music did not return an encrypted playlist artwork ID.", 500);
  }

  await editPlaylistWithRetries(config, playlistId, [playlistArtworkAction(uploadData.encryptedBlobId)]);
}

async function editPlaylistWithRetries(config: YouTubeMusicConfig, playlistId: string, actions: any[]): Promise<void> {
  let lastError: any;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await ytFetch("browse/edit_playlist", config, {
        playlistId,
        actions,
      });
      invalidateResponseCache(config.refreshToken);
      return;
    } catch (error: any) {
      lastError = error;
      if (!String(error?.message ?? error).includes("(409)") || attempt === 3) {
        throw error;
      }
      invalidateResponseCache(config.refreshToken);
      await sleep(600 * 2 ** attempt);
    }
  }
  throw lastError;
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

export async function handleFavoriteCollection(): Promise<SearchPlaylist> {
  return {
    id: "LM",
    provider: PROVIDER_ID,
    title: "Liked Music",
    author: null,
    trackCount: null,
    thumbnailURL: null,
    canAddTracks: false,
    canDelete: false,
  };
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
    canDelete: true,
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

export async function handleRemovePlaylistEntry(
  config: YouTubeMusicConfig,
  entryId: string,
  trackId: string,
  rawPlaylistId: string,
): Promise<void> {
  const playlistId = rawPlaylistId.startsWith("VL") ? rawPlaylistId.slice(2) : rawPlaylistId;
  await ytFetch("browse/edit_playlist", config, {
    playlistId,
    actions: [
      {
        action: "ACTION_REMOVE_VIDEO",
        removedVideoId: trackId,
        setVideoId: entryId,
      },
    ],
  });
  invalidateResponseCache(config.refreshToken);
}

async function loadAllPlaylistEntries(
  config: YouTubeMusicConfig,
  playlistId: string,
): Promise<{ title: string; entries: PlaylistEntry[] }> {
  const detail = await handlePlaylist(config, playlistId);
  const entries = [...detail.entries];
  let continuation = detail.continuation;
  while (continuation) {
    const page = await handlePlaylistMore(config, playlistId, continuation);
    entries.push(...page.entries);
    continuation = page.continuation;
  }
  return { title: detail.title, entries };
}

export async function handleUpdatePlaylist(
  config: YouTubeMusicConfig,
  request: PlaylistUpdateRequest,
): Promise<PlaylistDetail> {
  const playlistId = request.playlistID.startsWith("VL") ? request.playlistID.slice(2) : request.playlistID;
  const currentDetail = await handlePlaylist(config, request.playlistID);
  if (request.revision && currentDetail.revision !== request.revision) {
    throw new AddonError("The playlist changed on another device. Reload it and try again.", 409);
  }
  const current = await loadAllPlaylistEntries(config, request.playlistID);

  const requestedIDs = new Set(request.entries.map((entry) => entry.id));
  const removed = current.entries.filter((entry) => !requestedIDs.has(entry.id));
  if (removed.length > 0) {
    await editPlaylistWithRetries(
      config,
      playlistId,
      removed.map((entry) => ({
        action: "ACTION_REMOVE_VIDEO",
        removedVideoId: entry.track.id,
        setVideoId: entry.id,
      })),
    );
  }
  if (request.name !== current.title) {
    await editPlaylistWithRetries(config, playlistId, [
      {
        action: "ACTION_SET_PLAYLIST_NAME",
        playlistName: request.name,
      },
    ]);
  }
  for (const entry of request.entries) {
    await editPlaylistWithRetries(config, playlistId, [
      {
        action: "ACTION_MOVE_VIDEO_BEFORE",
        setVideoId: entry.id,
      },
    ]);
    await sleep(150);
  }
  if (request.artwork) {
    await uploadPlaylistArtwork(config, playlistId, request.artwork);
  }
  invalidateResponseCache(config.refreshToken);
  let latest = await handlePlaylist(config, request.playlistID);
  if (request.artwork) {
    for (let attempt = 0; attempt < 8 && latest.thumbnailURL === currentDetail.thumbnailURL; attempt++) {
      await sleep(500);
      invalidateResponseCache(config.refreshToken);
      latest = await handlePlaylist(config, request.playlistID);
    }
  }
  return latest;
}

export async function handleDeletePlaylist(config: YouTubeMusicConfig, rawPlaylistId: string): Promise<void> {
  const playlistId = rawPlaylistId.startsWith("VL") ? rawPlaylistId.slice(2) : rawPlaylistId;
  await ytFetch("playlist/delete", config, { playlistId });
  invalidateResponseCache(config.refreshToken);
}
