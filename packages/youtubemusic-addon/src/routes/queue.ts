import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import { resolveIFL } from "../ifl";
import { fillMissingTrackMetadata, parseTrackMetadata } from "../track-metadata";
import type { QueueAction, QueueContinuation, QueuePage, Station, Track, YouTubeMusicConfig } from "../types";
import { bestThumbnail, PROVIDER_ID, unwrapPlaylistPanelVideo } from "../utils";

export async function handleQueueStart(config: YouTubeMusicConfig, videoId: string, context?: any): Promise<QueuePage> {
  try {
    let playlistId: string | undefined;
    if (context) {
      try {
        const ctx = typeof context === "string" ? JSON.parse(Buffer.from(context, "base64").toString()) : context;
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
      videoId = await resolveIFL(config);
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
    const data = await ytFetch("next", config, body);
    const page = parseNextResponse(data, undefined, videoId);

    if (isIFL && page.tracks.length > 0) {
      page.tracks[0]!.id = "_ifl";
      page.tracks[0]!.isEphemeral = true;
    }

    await enrichAlbumInfo(config, page.tracks);

    console.log(`[queue] Got ${page.tracks.length} tracks, ${page.actions.length} chips`);
    return page;
  } catch (e: any) {
    console.error("Queue start error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

export async function handleQueueMore(config: YouTubeMusicConfig, token: string): Promise<QueuePage> {
  try {
    const data = await ytFetch("next", config, {
      continuation: token,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true,
    });

    const tracks: Track[] = [];
    const items = data?.continuationContents?.playlistPanelContinuation?.contents ?? [];
    for (const item of items) {
      const renderer = unwrapPlaylistPanelVideo(item);
      if (renderer) {
        const track = parsePlaylistPanelVideoRaw(renderer);
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

export async function handleStationStart(config: YouTubeMusicConfig, station: Station): Promise<QueuePage> {
  if (station.id !== "_ifl") {
    throw new AddonError("Unknown station", 404);
  }
  const seed = await resolveIFL(config);
  const page = await handleQueueStart(config, seed);
  return {
    ...page,
    title: station.title,
  };
}

export async function handleQueueAction(
  config: YouTubeMusicConfig,
  body: { action: QueueAction; currentTrack: Track },
): Promise<QueuePage> {
  try {
    const { action, currentTrack } = body;
    const playlistId = action.payload.data.playlistId;
    const params = action.payload.data.params;

    if (!playlistId) {
      throw new AddonError("Missing playlistId in action payload", 400);
    }

    const data = await ytFetch("next", config, {
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

    const page = parseNextResponse(data, playlistId, currentTrack.id);
    return page;
  } catch (e: any) {
    console.error("Queue action error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

function parseNextResponse(data: any, overridePlaylistId?: string, seedVideoId?: string): QueuePage {
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
      const renderer = unwrapPlaylistPanelVideo(item, seedVideoId);
      if (renderer) {
        const track = parsePlaylistPanelVideoRaw(renderer);
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

async function enrichAlbumInfo(config: YouTubeMusicConfig, tracks: Track[]): Promise<void> {
  const needsAlbum = tracks.filter((t) => !t.album);
  if (!needsAlbum.length) return;

  const meta = await fetchBatchTrackMetadata(
    config,
    needsAlbum.map((t) => t.id),
  );

  let enriched = 0;
  for (const track of needsAlbum) {
    const fetched = meta.get(track.id);
    if (!fetched) continue;
    fillMissingTrackMetadata(track, fetched);
    const album = fetched.album;
    if (album?.id) {
      track.album = album;
      enriched++;
    }
  }
  if (enriched > 0) console.log(`[queue] Enriched ${enriched}/${needsAlbum.length} tracks with album info`);
}

export async function fetchBatchTrackMetadata(
  config: YouTubeMusicConfig,
  videoIds: string[],
): Promise<Map<string, Track>> {
  const result = new Map<string, Track>();
  const ids = [...new Set(videoIds.filter(Boolean))].slice(0, 50);
  if (ids.length === 0) return result;

  try {
    const data = await ytFetch("music/get_queue", config, { videoIds: ids });
    const queueDatas = data?.queueDatas ?? [];
    for (const qd of queueDatas) {
      const renderer = unwrapPlaylistPanelVideo(qd?.content);
      if (!renderer) continue;
      const track = parsePlaylistPanelVideoRaw(renderer);
      if (track) result.set(track.id, track);
    }
  } catch (e: any) {
    console.error("[metadata] get_queue batch failed:", e.message);
  }
  return result;
}

export function parsePlaylistPanelVideoRaw(renderer: any): Track | null {
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
    ...parseTrackMetadata(renderer),
  };
}
