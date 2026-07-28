import { AddonError } from "@resonance-addons/sdk";
import { getAccessToken, invalidateSpotifyResponseCache, pathfinderRequest, spotifyFetch } from "../auth";
import type { PlaylistDetail, PlaylistEntry, PlaylistUpdateRequest, SearchPlaylist } from "../types";
import { getUserId, OperationHash, PROVIDER_ID, pf, uriToId } from "../utils";
import { handlePlaylist } from "./playlist";

const PLAYLIST_V2 = "https://spclient.wg.spotify.com/playlist/v2";
const WEB_PLAYER_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "App-Platform": "WebPlayer",
  "Spotify-App-Version": "1.2.80.313.gd1726b65",
};

async function playlistV2Request(
  spDc: string,
  path: string,
  body: Record<string, any>,
  retryable = false,
): Promise<any> {
  let lastError: AddonError | null = null;
  for (let attempt = 0; attempt < (retryable ? 4 : 1); attempt++) {
    const token = await getAccessToken(spDc);
    const response = await spotifyFetch(
      `${PLAYLIST_V2}${path}`,
      {
        method: "POST",
        headers: {
          ...WEB_PLAYER_HEADERS,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
      { cacheable: false },
    );
    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (response.ok) return data;
    lastError = new AddonError(
      `Spotify playlist request failed (${response.status}): ${String(text).slice(0, 200)}`,
      response.status,
    );
    if (!retryable || (response.status !== 429 && response.status < 500) || attempt === 3) {
      throw lastError;
    }
    const retryAfter = Number(response.headers.get("retry-after") ?? 0);
    await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1_000, 500 * 2 ** attempt)));
  }
  throw lastError ?? new AddonError("Spotify playlist request failed", 500);
}

async function uploadPlaylistImage(spDc: string, playlistId: string, dataBase64: string): Promise<string> {
  const token = await getAccessToken(spDc);
  const upload = await spotifyFetch(
    "https://image-upload.spotify.com/v4/playlist",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/jpeg",
      },
      body: Buffer.from(dataBase64, "base64"),
    },
    { cacheable: false },
  );
  const uploadBody: any = await upload.json();
  if (!upload.ok || !uploadBody?.uploadToken) {
    throw new AddonError(`Spotify image upload failed (${upload.status})`, upload.status);
  }
  const registered = await playlistV2Request(
    spDc,
    `/playlist/${encodeURIComponent(playlistId)}/register-image`,
    {
      uploadToken: uploadBody.uploadToken,
    },
    true,
  );
  if (!registered?.picture) {
    throw new AddonError("Spotify did not return a registered playlist image.", 500);
  }
  return registered.picture;
}

async function updatePlaylistAttributes(spDc: string, playlistId: string, values: Record<string, any>): Promise<any> {
  return playlistV2Request(
    spDc,
    `/playlist/${encodeURIComponent(playlistId)}/changes`,
    {
      deltas: [
        {
          ops: [
            {
              kind: "UPDATE_LIST_ATTRIBUTES",
              updateListAttributes: {
                newAttributes: {
                  values: {
                    ...values,
                    formatAttributes: [],
                    pictureSize: [],
                  },
                  noValue: [],
                },
              },
            },
          ],
          info: {
            source: {
              client: "WEBPLAYER",
            },
          },
        },
      ],
    },
    true,
  );
}

async function mutatePlaylist(
  spDc: string,
  name: "addToPlaylist" | "removeFromPlaylist" | "moveItemsInPlaylist",
  variables: any,
) {
  const response = await pathfinderRequest(spDc, {
    name,
    hash: OperationHash.playlistMutation,
    variables,
  });
  if (response?.errors?.length) {
    throw new AddonError(response.errors[0]?.message ?? `Spotify ${name} failed`, 500);
  }
  return response?.data;
}

async function fetchAllPlaylistEntries(
  spDc: string,
  playlistId: string,
): Promise<{ name: string; entries: PlaylistEntry[] }> {
  const entries: PlaylistEntry[] = [];
  let offset = 0;
  let name = "";
  while (true) {
    const page = await fetchPlaylistPage(spDc, playlistId, offset);
    const playlist = page?.playlistV2;
    name ||= playlist?.name ?? "";
    const rawItems = playlist?.content?.items ?? [];
    for (const item of rawItems) {
      const uid = item?.uid;
      const track = item?.itemV2?.data;
      const id = track?.uri?.split(":").pop();
      if (!uid || !id || track?.__typename !== "Track") continue;
      entries.push({
        id: String(uid),
        track: {
          id: String(id),
          provider: PROVIDER_ID,
          title: track?.name ?? "",
          artists: (track?.artists?.items ?? []).map((artist: any) => ({
            id: artist?.uri?.split(":").pop() ?? null,
            name: artist?.profile?.name ?? "",
          })),
          album: track?.albumOfTrack
            ? {
                id: track.albumOfTrack.uri?.split(":").pop() ?? null,
                name: track.albumOfTrack.name ?? "",
              }
            : null,
          duration: null,
          durationSeconds:
            typeof track?.trackDuration?.totalMilliseconds === "number"
              ? Math.round(track.trackDuration.totalMilliseconds / 1000)
              : null,
          thumbnailURL: null,
          isExplicit: track?.contentRating?.label === "EXPLICIT",
        },
      });
    }
    const total = playlist?.content?.totalCount;
    offset += rawItems.length;
    if (rawItems.length === 0 || typeof total !== "number" || offset >= total) break;
  }
  return { name, entries };
}

async function fetchPlaylistPage(spDc: string, playlistId: string, offset: number): Promise<any> {
  return pf(spDc, {
    name: "fetchPlaylist",
    hash: OperationHash.fetchPlaylist,
    variables: {
      uri: `spotify:playlist:${playlistId}`,
      offset,
      limit: 50,
      enableWatchFeedEntrypoint: true,
    },
  });
}

export async function handleGetLikeStatus(spDc: string, trackId: string): Promise<string> {
  try {
    const data = await pf(spDc, {
      name: "areEntitiesInLibrary",
      hash: OperationHash.areEntitiesInLibrary,
      variables: {
        uris: [`spotify:track:${trackId}`],
      },
    });

    return data?.lookup?.[0]?.data?.saved ? "liked" : "none";
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to get like status", 500);
  }
}

export async function handleSetLikeStatus(spDc: string, status: string, trackId: string): Promise<void> {
  try {
    const targetStatus = status === "liked" ? "liked" : "none";
    const operation =
      targetStatus === "liked"
        ? { name: "addToLibrary", hash: OperationHash.addToLibrary }
        : { name: "removeFromLibrary", hash: OperationHash.removeFromLibrary };

    await pf(spDc, {
      name: operation.name,
      hash: operation.hash,
      variables: {
        libraryItemUris: [`spotify:track:${trackId}`],
      },
    });
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to set like status", 500);
  }
}

export async function handleFavoriteCollection(): Promise<SearchPlaylist> {
  return {
    id: "tracks",
    provider: PROVIDER_ID,
    title: "Liked Songs",
    author: null,
    trackCount: null,
    thumbnailURL: "https://misc.scdn.co/liked-songs/liked-songs-640.png",
    canAddTracks: false,
    canDelete: false,
  };
}

export async function handleAddToPlaylist(spDc: string, trackId: string, playlistId: string): Promise<void> {
  try {
    if (!trackId || !playlistId) {
      throw new AddonError("Missing trackId or playlistId", 400);
    }
    await mutatePlaylist(spDc, "addToPlaylist", {
      playlistUri: `spotify:playlist:${playlistId}`,
      playlistItemUris: [`spotify:track:${trackId}`],
      newPosition: {
        moveType: "BOTTOM_OF_PLAYLIST",
        fromUid: null,
      },
    });
    invalidateSpotifyResponseCache();
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to add to playlist", 500);
  }
}

export async function handleCreatePlaylist(spDc: string, name: string): Promise<SearchPlaylist> {
  try {
    const trimmed = name.trim();
    if (!trimmed) throw new AddonError("Playlist name is required", 400);

    const created = await playlistV2Request(spDc, "/playlist", {
      ops: [
        {
          kind: "UPDATE_LIST_ATTRIBUTES",
          updateListAttributes: {
            newAttributes: {
              values: {
                name: trimmed,
                formatAttributes: [],
                pictureSize: [],
              },
              noValue: [],
            },
          },
        },
      ],
    });
    const playlistUri = created?.uri as string | undefined;
    if (!playlistUri) throw new AddonError("Spotify did not return a playlist URI", 500);

    const username = await getUserId(spDc);
    await playlistV2Request(spDc, `/user/${encodeURIComponent(username)}/rootlist/changes`, {
      deltas: [
        {
          ops: [
            {
              kind: "ADD",
              add: {
                addFirst: true,
                items: [
                  {
                    uri: playlistUri,
                    attributes: {
                      timestamp: String(Date.now()),
                      formatAttributes: [],
                      availableSignals: [],
                    },
                  },
                ],
              },
            },
          ],
          info: {
            source: {
              client: "WEBPLAYER",
            },
          },
        },
      ],
    });
    invalidateSpotifyResponseCache();

    return {
      id: uriToId(playlistUri),
      provider: "net.itsnebula.spotify",
      title: trimmed,
      author: null,
      trackCount: "0 songs",
      thumbnailURL: null,
      canAddTracks: true,
      canDelete: true,
    };
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to create playlist", 500);
  }
}

export async function handleRemoveFromPlaylist(spDc: string, trackId: string, playlistId: string): Promise<void> {
  try {
    if (!trackId || !playlistId) throw new AddonError("Missing trackId or playlistId", 400);
    const trackUri = `spotify:track:${trackId}`;
    let offset = 0;
    let itemUid: string | null = null;

    while (itemUid == null) {
      const page = await fetchPlaylistPage(spDc, playlistId, offset);
      const content = page?.playlistV2?.content;
      const items = content?.items ?? [];
      const item = items.find((entry: any) => entry?.itemV2?.data?.uri === trackUri);
      if (item?.uid) {
        itemUid = item.uid;
        break;
      }
      const total = content?.totalCount;
      offset += items.length;
      if (items.length === 0 || typeof total !== "number" || offset >= total) break;
    }

    if (!itemUid) throw new AddonError("Track was not found in this Spotify playlist", 404);
    await mutatePlaylist(spDc, "removeFromPlaylist", {
      playlistUri: `spotify:playlist:${playlistId}`,
      uids: [itemUid],
    });
    invalidateSpotifyResponseCache();
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to remove from playlist", 500);
  }
}

export async function handleRemovePlaylistEntry(
  spDc: string,
  entryId: string,
  _trackId: string,
  playlistId: string,
): Promise<void> {
  await mutatePlaylist(spDc, "removeFromPlaylist", {
    playlistUri: `spotify:playlist:${playlistId}`,
    uids: [entryId],
  });
  invalidateSpotifyResponseCache();
}

export async function handleUpdatePlaylist(spDc: string, request: PlaylistUpdateRequest): Promise<PlaylistDetail> {
  const currentDetail = await handlePlaylist(spDc, request.playlistID);
  if (request.revision && currentDetail.revision !== request.revision) {
    throw new AddonError("The playlist changed on another device. Reload it and try again.", 409);
  }
  const current = await fetchAllPlaylistEntries(spDc, request.playlistID);
  if (request.name !== current.name) {
    throw new AddonError("Spotify playlist renaming is unavailable with the current authentication method.", 400);
  }

  let picture: string | undefined;
  if (request.artwork) {
    picture = await uploadPlaylistImage(spDc, request.playlistID, request.artwork.data);
  }
  if (picture) {
    await updatePlaylistAttributes(spDc, request.playlistID, {
      picture,
    });
  }

  const requestedIDs = new Set(request.entries.map((entry) => entry.id));
  const removedIDs = current.entries.map((entry) => entry.id).filter((id) => !requestedIDs.has(id));
  if (removedIDs.length > 0) {
    await mutatePlaylist(spDc, "removeFromPlaylist", {
      playlistUri: `spotify:playlist:${request.playlistID}`,
      uids: removedIDs,
    });
  }

  for (const entry of request.entries) {
    await mutatePlaylist(spDc, "moveItemsInPlaylist", {
      playlistUri: `spotify:playlist:${request.playlistID}`,
      uids: [entry.id],
      newPosition: {
        moveType: "BOTTOM_OF_PLAYLIST",
        fromUid: null,
      },
    });
  }

  invalidateSpotifyResponseCache();
  let latest = await handlePlaylist(spDc, request.playlistID);
  const requestedTrackIDs = request.entries.map((entry) => entry.track.id);
  for (let attempt = 0; attempt < 10; attempt++) {
    if (
      latest.title === request.name &&
      latest.entries.map((entry) => entry.track.id).join(",") === requestedTrackIDs.join(",")
    ) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    invalidateSpotifyResponseCache();
    latest = await handlePlaylist(spDc, request.playlistID);
  }
  return latest;
}

export async function handleDeletePlaylist(spDc: string, playlistId: string): Promise<void> {
  const username = await getUserId(spDc);
  await playlistV2Request(spDc, `/user/${encodeURIComponent(username)}/rootlist/changes`, {
    deltas: [
      {
        ops: [
          {
            kind: "REM",
            rem: {
              itemsAsKey: true,
              items: [{ uri: `spotify:playlist:${playlistId}` }],
            },
          },
        ],
        info: {
          source: {
            client: "WEBPLAYER",
          },
        },
      },
    ],
  });
  invalidateSpotifyResponseCache();
}
