import { AddonError } from "@resonance-addons/sdk";
import { getAccessToken, pathfinderRequest, spotifyFetch } from "../auth";
import type { SearchPlaylist } from "../types";
import { getUserId, OperationHash, pf, uriToId } from "../utils";

const PLAYLIST_V2 = "https://spclient.wg.spotify.com/playlist/v2";
const WEB_PLAYER_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "App-Platform": "WebPlayer",
  "Spotify-App-Version": "1.2.80.313.gd1726b65",
};

async function playlistV2Request(spDc: string, path: string, body: Record<string, any>): Promise<any> {
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
  if (!response.ok) {
    throw new AddonError(
      `Spotify playlist request failed (${response.status}): ${String(text).slice(0, 200)}`,
      response.status,
    );
  }
  return data;
}

async function mutatePlaylist(spDc: string, name: "addToPlaylist" | "removeFromPlaylist", variables: any) {
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

    return {
      id: uriToId(playlistUri),
      provider: "net.itsnebula.spotify",
      title: trimmed,
      author: null,
      trackCount: "0 songs",
      thumbnailURL: null,
      canAddTracks: true,
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
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to remove from playlist", 500);
  }
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
}
