import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import { resolveIFL } from "../ifl";
import type { QueueAction, QueueContinuation, QueuePage, Track } from "../types";
import { bestThumbnail, PROVIDER_ID } from "../utils";
import { lookupAlbumId } from "./search";

export async function handleQueueStart(refreshToken: string, videoId: string, contextB64?: string): Promise<QueuePage> {
  try {
    let playlistId: string | undefined;
    if (contextB64) {
      try {
        const ctx = JSON.parse(Buffer.from(contextB64, "base64").toString());
        let id: string | undefined = ctx.id;
        if (id?.startsWith("VL")) id = id.slice(2);
        if (id && !id.startsWith("MPRE")) {
          if (ctx.type === "album") playlistId = id;
          else if (ctx.type === "playlist") playlistId = id;
          else playlistId = id;
        }
      } catch {}
    }

    const isIFL = playlistId === "_ifl";
    if (isIFL) {
      videoId = await resolveIFL(refreshToken);
      playlistId = undefined;
    }

    const isRadio = !playlistId;
    const body: any = {
      videoId,
      playlistId: playlistId ?? `RDAMVM${videoId}`,
      isAudioOnly: true,
      tunerSettingValue: "AUTOMIX_SETTING_NORMAL",
      enablePersistentPlaylistPanel: true,
    };
    if (isRadio) {
      body.params = "wAEB";
    }
    body.watchEndpointMusicSupportedConfigs = {
      watchEndpointMusicConfig: {
        hasPersistentPlaylistPanel: true,
        musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
      },
    };

    console.log(`[queue] Starting queue for ${videoId}, playlistId=${body.playlistId}`);
    const data = await ytFetch("next", refreshToken, body);
    const page = parseNextResponse(data);

    if (isIFL && page.tracks.length > 0) {
      page.tracks[0]!.id = "_ifl";
    }

    await enrichAlbumInfo(refreshToken, page.tracks);

    console.log(`[queue] Got ${page.tracks.length} tracks, ${page.actions.length} chips`);
    return page;
  } catch (e: any) {
    console.error("Queue start error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

export async function handleQueueMore(refreshToken: string, token: string): Promise<QueuePage> {
  try {
    const data = await ytFetch("next", refreshToken, {
      continuation: token,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true,
    });

    const tracks: Track[] = [];
    const items = data?.continuationContents?.playlistPanelContinuation?.contents ?? [];
    for (const item of items) {
      if (item.playlistPanelVideoRenderer) {
        const track = parsePlaylistPanelVideoRaw(item.playlistPanelVideoRenderer);
        if (track) tracks.push(track);
      }
    }

    const nextContinuation = data?.continuationContents?.playlistPanelContinuation?.continuations?.[0];
    const nextToken =
      nextContinuation?.nextContinuationData?.continuation ?? nextContinuation?.nextRadioContinuationData?.continuation;

    const page: QueuePage = {
      tracks,
      continuation: nextToken ? { providerID: PROVIDER_ID, token: nextToken } : null,
      actions: [],
      title: null,
      likeStatus: null,
    };

    return page;
  } catch (e: any) {
    console.error("Queue more error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

export async function handleQueueAction(
  refreshToken: string,
  body: { action: QueueAction; currentTrack: Track },
): Promise<QueuePage> {
  try {
    const { action, currentTrack } = body;
    const playlistId = action.payload.data.playlistId;
    const params = action.payload.data.params;

    if (!playlistId) {
      throw new AddonError("Missing playlistId in action payload", 400);
    }

    const data = await ytFetch("next", refreshToken, {
      videoId: currentTrack.id,
      playlistId,
      params: params || undefined,
      isAudioOnly: true,
      tunerSettingValue: "AUTOMIX_SETTING_NORMAL",
      enablePersistentPlaylistPanel: true,
      watchEndpointMusicSupportedConfigs: {
        watchEndpointMusicConfig: {
          hasPersistentPlaylistPanel: true,
          musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
        },
      },
    });

    const page = parseNextResponse(data, playlistId);
    return page;
  } catch (e: any) {
    console.error("Queue action error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

function parseNextResponse(data: any, overridePlaylistId?: string): QueuePage {
  const tracks: Track[] = [];
  const actions: QueueAction[] = [];
  let continuation: QueueContinuation | null = null;
  let likeStatus: "liked" | "disliked" | "none" | null = null;
  let relatedBrowseId: string | null = null;

  const tabs =
    data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;

  const firstTab = tabs?.[0]?.tabRenderer;
  const queueRenderer = firstTab?.content?.musicQueueRenderer;
  const panel = queueRenderer?.content?.playlistPanelRenderer;

  if (panel) {
    for (const item of panel.contents ?? []) {
      if (item.playlistPanelVideoRenderer) {
        const track = parsePlaylistPanelVideoRaw(item.playlistPanelVideoRenderer);
        if (track) tracks.push(track);
      }
    }

    const chipCloud = queueRenderer?.subHeaderChipCloud?.chipCloudRenderer?.chips;
    if (chipCloud) {
      for (const chip of chipCloud) {
        const cr = chip.chipCloudChipRenderer;
        if (!cr) continue;
        const text = cr.text?.runs?.[0]?.text ?? cr.text ?? "";
        const isSelected = cr.isSelected ?? false;
        const uniqueId = cr.uniqueId ?? text;
        const nav = cr.navigationEndpoint?.queueUpdateCommand?.fetchContentsCommand?.watchEndpoint;
        if (nav?.playlistId) {
          actions.push({
            id: uniqueId,
            title: text,
            isSelected,
            payload: {
              providerID: PROVIDER_ID,
              data: {
                playlistId: nav.playlistId,
                params: nav.params ?? "",
              },
            },
          });
        }
      }
    }

    const contData = panel.continuations?.[0];
    const contToken = contData?.nextContinuationData?.continuation ?? contData?.nextRadioContinuationData?.continuation;
    if (contToken) {
      continuation = { providerID: PROVIDER_ID, token: contToken };
    }
  }

  const playerOverlayActions = data?.playerOverlays?.playerOverlayRenderer?.actions;
  if (playerOverlayActions) {
    for (const action of playerOverlayActions) {
      const status = action?.likeButtonRenderer?.likeStatus;
      if (status === "LIKE") likeStatus = "liked";
      else if (status === "DISLIKE") likeStatus = "disliked";
      else if (status === "INDIFFERENT") likeStatus = "none";
    }
  }

  // Related tab
  if (tabs) {
    for (const tab of tabs.slice(2)) {
      const browseId = tab?.tabRenderer?.endpoint?.browseEndpoint?.browseId;
      if (browseId) {
        relatedBrowseId = browseId;
        break;
      }
    }
  }

  const playlistId = overridePlaylistId ?? panel?.playlistId ?? null;

  return {
    tracks,
    continuation,
    actions,
    title: panel?.title ?? null,
    likeStatus,
    playlistId,
    relatedBrowseId,
  };
}

async function enrichAlbumInfo(refreshToken: string, tracks: Track[]): Promise<void> {
  const needsAlbum = tracks.filter((t) => !t.album).slice(0, 5);
  if (!needsAlbum.length) return;

  const results = await Promise.allSettled(
    needsAlbum.map(async (t) => {
      const artist = t.artists[0]?.name ?? "";
      const albumId = await lookupAlbumId(refreshToken, `${t.title} ${artist}`, t.id);
      return { trackId: t.id, albumId };
    }),
  );

  let enriched = 0;
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.albumId) continue;
    const track = tracks.find((t) => t.id === result.value.trackId);
    if (track) {
      (track as any).album = { id: result.value.albumId, name: "" };
      enriched++;
    }
  }
  if (enriched > 0) console.log(`[queue] Enriched ${enriched}/${needsAlbum.length} tracks with album IDs`);
}

function parsePlaylistPanelVideoRaw(renderer: any): Track | null {
  const videoId = renderer.videoId;
  if (!videoId) return null;

  const title = renderer.title?.runs?.[0]?.text ?? "";

  let menuArtistId: string | null = null;
  let menuAlbumId: string | null = null;
  let menuAlbumName: string | null = null;
  const menuItems = renderer.menu?.menuRenderer?.items ?? [];
  for (const mi of menuItems) {
    const nav = mi.menuNavigationItemRenderer;
    if (!nav) continue;
    const browseEp = nav.navigationEndpoint?.browseEndpoint;
    if (!browseEp) continue;
    const pageType = browseEp.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    if (pageType === "MUSIC_PAGE_TYPE_ARTIST" && !menuArtistId) {
      menuArtistId = browseEp.browseId ?? null;
    } else if (pageType === "MUSIC_PAGE_TYPE_ALBUM" && !menuAlbumId) {
      menuAlbumId = browseEp.browseId ?? null;
      menuAlbumName = nav.text?.runs?.[0]?.text === "Go to album" ? null : nav.text?.runs?.[0]?.text;
    }
  }

  const artists: Track["artists"] = [];
  const shortByline = renderer.shortBylineText?.runs ?? [];
  const longByline = renderer.longBylineText?.runs ?? [];

  for (const run of shortByline) {
    const text = run.text ?? "";
    if (text === " & " || text === ", " || text === " • " || text === " • ") continue;
    const browseId = run.navigationEndpoint?.browseEndpoint?.browseId ?? null;
    artists.push({ id: browseId, name: text });
  }

  if (artists.length === 0) {
    for (const run of longByline) {
      const text = run.text ?? "";
      if (text === " • " || text === " • ") break;
      if (text === " & " || text === ", ") continue;
      const browseId = run.navigationEndpoint?.browseEndpoint?.browseId ?? null;
      artists.push({ id: browseId, name: text });
    }
  }

  if (menuArtistId && artists.length > 0 && !artists[0]!.id) {
    artists[0]!.id = menuArtistId;
  }

  const albumRun = longByline.find(
    (r: any) =>
      r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig
        ?.pageType === "MUSIC_PAGE_TYPE_ALBUM",
  );

  let album: Track["album"] = null;
  if (albumRun) {
    album = {
      id: albumRun.navigationEndpoint?.browseEndpoint?.browseId ?? menuAlbumId,
      name: albumRun.text,
    };
  } else if (menuAlbumId) {
    album = { id: menuAlbumId, name: menuAlbumName ?? "" };
  }

  const durationText = renderer.lengthText?.runs?.[0]?.text;
  let durationSeconds: number | null = null;
  if (durationText) {
    const parts = durationText.split(":").map(Number);
    if (parts.length === 2) durationSeconds = (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    else if (parts.length === 3) durationSeconds = (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }

  const thumbnails = renderer.thumbnail?.thumbnails ?? [];
  const thumbnailUrl = bestThumbnail(thumbnails);

  return {
    id: videoId,
    provider: PROVIDER_ID,
    title,
    artists,
    album,
    duration: durationText ?? null,
    durationSeconds,
    thumbnailURL: thumbnailUrl,
    isExplicit: false,
  };
}
