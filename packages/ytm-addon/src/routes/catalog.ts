import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import type { CatalogPage, HomeItem, HomeSection, QuickAccessItem } from "../types";
import { PROVIDER_ID } from "../utils";
import { lookupAlbumId } from "./search";

export async function handleHome(refreshToken: string, continuation?: string): Promise<CatalogPage> {
  try {
    let sections: HomeSection[] = [];
    let quickAccess: QuickAccessItem[] | null = null;
    let nextContinuation: string | null = null;

    if (continuation) {
      console.log("[catalog] Fetching home continuation...");
      const data = await ytFetch("browse", refreshToken, { continuation });
      const contContents = data?.continuationContents?.sectionListContinuation?.contents ?? [];
      sections = parseSections(contContents);
      nextContinuation =
        data?.continuationContents?.sectionListContinuation?.continuations?.[0]?.nextContinuationData?.continuation ??
        null;
      console.log(`[catalog] Continuation: ${sections.length} sections`);
    } else {
      console.log("[catalog] Fetching home feed (IOS_MUSIC)...");
      const data = await ytFetch("browse", refreshToken, { browseId: "FEmusic_home" });

      const sectionList =
        data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer;
      const contents = sectionList?.contents ?? [];

      for (const section of contents) {
        const sectionContents = section?.itemSectionRenderer?.contents;
        if (!Array.isArray(sectionContents)) continue;

        for (const content of sectionContents) {
          const model = content?.elementRenderer?.newElement?.type?.componentType?.model;

          const speedDialItems = model?.musicSpeedDialShelfModel?.data?.items;
          if (Array.isArray(speedDialItems)) {
            quickAccess = parseSpeedDialItems(speedDialItems);
            continue;
          }

          const carousel = model?.musicGridItemCarouselModel ?? model?.musicListItemCarouselModel;
          if (carousel) {
            const parsed = parseCarouselSection(carousel);
            if (parsed) sections.push(parsed);
          }
        }
      }

      nextContinuation = sectionList?.continuations?.[0]?.nextContinuationData?.continuation ?? null;

      let contAttempts = 0;
      while (nextContinuation && contAttempts < 10) {
        contAttempts++;
        try {
          const contData = await ytFetch("browse", refreshToken, { continuation: nextContinuation });
          const contContents = contData?.continuationContents?.sectionListContinuation?.contents ?? [];
          const contSections = parseSections(contContents);
          sections.push(...contSections);
          console.log(
            `[catalog] Continuation ${contAttempts}: +${contSections.length} sections (total: ${sections.length})`,
          );
          nextContinuation =
            contData?.continuationContents?.sectionListContinuation?.continuations?.[0]?.nextContinuationData
              ?.continuation ?? null;
          if (contSections.length === 0) break;
        } catch (e: any) {
          console.error("[catalog] Continuation error:", e.message);
          break;
        }
      }

      if (quickAccess && quickAccess.length > 0) {
        const iflIdx = quickAccess.findIndex((qa) => qa.action.type === "playTrack" && qa.action.trackId === "_ifl");
        if (iflIdx !== -1) {
          quickAccess[iflIdx]!.thumbnailURL = "https://i.postimg.cc/TPjG84Sq/edited.webp";
        }

        const albumLookups = new Map<string, string | null>();
        await Promise.allSettled(
          quickAccess
            .filter((qa) => qa.action.type === "playTrack" && qa.action.trackId && qa.action.trackId !== "_ifl")
            .map(async (qa) => {
              const artist = qa.artistName ?? "";
              const albumId = await lookupAlbumId(refreshToken, `${qa.title} ${artist}`, qa.action.trackId!);
              albumLookups.set(qa.action.trackId!, albumId);
            }),
        );

        const speedDialItems: HomeItem[] = quickAccess.flatMap((qa): HomeItem[] => {
          switch (qa.action.type) {
            case "playTrack": {
              const albumId = albumLookups.get(qa.action.trackId!) ?? null;
              return [
                {
                  type: "track" as const,
                  track: {
                    id: qa.action.trackId!,
                    provider: PROVIDER_ID,
                    title: qa.title,
                    artists: qa.artistName ? [{ id: null, name: qa.artistName }] : [],
                    album: albumId ? { id: albumId, name: "" } : null,
                    duration: null,
                    durationSeconds: null,
                    thumbnailURL: qa.thumbnailURL,
                    isExplicit: false,
                  },
                  playlistId: qa.action.playlistId ?? undefined,
                },
              ];
            }
            case "openPlaylist":
              return [
                {
                  type: "playlist" as const,
                  playlist: {
                    id: qa.action.browseId!,
                    provider: PROVIDER_ID,
                    title: qa.title,
                    author: null,
                    trackCount: null,
                    thumbnailURL: qa.thumbnailURL,
                  },
                },
              ];
            case "openAlbum":
              return [
                {
                  type: "album" as const,
                  album: {
                    id: qa.action.browseId!,
                    provider: PROVIDER_ID,
                    title: qa.title,
                    artists: qa.artistName ? [{ id: null, name: qa.artistName }] : [],
                    year: null,
                    thumbnailURL: qa.thumbnailURL,
                    isExplicit: false,
                  },
                },
              ];
            default:
              return [];
          }
        });
        sections.unshift({
          id: crypto.randomUUID(),
          title: "Speed dial",
          items: speedDialItems,
          style: "quickAccess",
        });
      }

      console.log(`[catalog] Done: ${sections.length} sections`);
    }

    const page: CatalogPage = {
      sections,
      filters: [],
      quickAccess: null,
      continuation: nextContinuation ? { providerID: PROVIDER_ID, token: nextContinuation } : null,
    };

    return page;
  } catch (e: any) {
    console.error("Home feed error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

function parseSections(contents: any[]): HomeSection[] {
  const sections: HomeSection[] = [];
  for (const section of contents) {
    const sectionContents = section?.itemSectionRenderer?.contents;
    if (!Array.isArray(sectionContents)) continue;

    for (const content of sectionContents) {
      const model = content?.elementRenderer?.newElement?.type?.componentType?.model;
      const carousel = model?.musicGridItemCarouselModel ?? model?.musicListItemCarouselModel;
      if (carousel) {
        const parsed = parseCarouselSection(carousel);
        if (parsed) sections.push(parsed);
      }
    }
  }
  return sections;
}

function parseCarouselSection(carousel: any): HomeSection | null {
  const shelf = carousel?.shelf ?? carousel;
  const title = shelf?.header?.title ?? shelf?.title ?? "Untitled";
  const rawItems = shelf?.items ?? [];
  const items: HomeItem[] = [];

  for (const item of rawItems) {
    const parsed = parseIOSItem(item);
    if (parsed) items.push(parsed);
  }

  if (items.length === 0) return null;

  const isQuickPicks = typeof title === "string" && title.toLowerCase().includes("quick picks");
  return {
    id: crypto.randomUUID(),
    title,
    items,
    style: isQuickPicks ? "quickPicks" : "cards",
  };
}

function parseIOSItem(item: any): HomeItem | null {
  const title = item.title ?? "";
  const subtitle = item.subtitle ?? "";
  const thumbnailSources = item.thumbnail?.image?.sources ?? [];
  const thumbnailURL =
    thumbnailSources.length > 0 ? (thumbnailSources[thumbnailSources.length - 1]?.url ?? null) : null;

  const cmd = item.onTap?.innertubeCommand;
  const browseId = cmd?.browseEndpoint?.browseId;
  const videoId = cmd?.watchEndpoint?.videoId;
  const playlistId = cmd?.watchEndpoint?.playlistId;
  const pageType =
    cmd?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;

  if (videoId) {
    return {
      type: "track",
      track: {
        id: videoId,
        provider: PROVIDER_ID,
        title,
        artists: parseArtistsFromSubtitle(subtitle),
        album: null,
        duration: null,
        durationSeconds: null,
        thumbnailURL,
        isExplicit: false,
      },
      playlistId: playlistId ?? undefined,
    };
  }
  if (pageType === "MUSIC_PAGE_TYPE_ALBUM") {
    return {
      type: "album",
      album: {
        id: browseId ?? "",
        provider: PROVIDER_ID,
        title,
        artists: parseArtistsFromSubtitle(subtitle),
        year: null,
        thumbnailURL,
        isExplicit: false,
      },
    };
  }
  if (pageType === "MUSIC_PAGE_TYPE_PLAYLIST") {
    return {
      type: "playlist",
      playlist: {
        id: browseId ?? "",
        provider: PROVIDER_ID,
        title,
        author: subtitle || null,
        trackCount: null,
        thumbnailURL,
      },
    };
  }
  if (pageType === "MUSIC_PAGE_TYPE_ARTIST") {
    return {
      type: "artist",
      artist: {
        id: browseId ?? "",
        provider: PROVIDER_ID,
        name: title,
        thumbnailURL,
        subscriberCount: null,
      },
    };
  }
  return null;
}

const SUBTITLE_TYPE_PREFIXES = ["song", "album", "video", "single", "ep", "playlist", "artist", "podcast", "episode"];

function parseArtistsFromSubtitle(subtitle: string): { id: string | null; name: string }[] {
  if (!subtitle) return [];
  const parts = subtitle.split(" • ");

  let artistPart = parts[0] ?? "";
  if (SUBTITLE_TYPE_PREFIXES.includes(artistPart.toLowerCase()) && parts.length > 1) {
    artistPart = parts[1] ?? "";
  }

  artistPart = artistPart.replace(/\s*[\d.]+[KMB]?\s*(plays|views|subscribers)$/i, "");

  if (!artistPart) return [];
  return artistPart
    .split(", ")
    .filter(Boolean)
    .map((name) => ({ id: null, name: name.trim() }));
}

function parseSpeedDialItems(items: any[]): QuickAccessItem[] {
  const result: QuickAccessItem[] = [];

  for (const item of items) {
    if (item.isShortcut && item.onTapAnimation?.url?.includes("IFL")) {
      result.push({
        id: crypto.randomUUID(),
        title: "I'm Feeling Lucky",
        thumbnailURL: null,
        action: { type: "playTrack", trackId: "_ifl", playlistId: "_ifl" },
      });
      continue;
    }

    const title = item.title;
    if (!title) continue;

    const thumbnailSources = item.thumbnail?.image?.sources ?? [];
    const thumbnailURL =
      thumbnailSources.length > 0 ? (thumbnailSources[thumbnailSources.length - 1]?.url ?? null) : null;

    const menuTitle =
      item.onLongPress?.innertubeCommand?.menuEndpoint?.menu?.menuRenderer?.title?.musicMenuTitleRenderer;
    const secondaryRuns = menuTitle?.secondaryText?.runs;
    const artistName = Array.isArray(secondaryRuns) ? (secondaryRuns[0]?.text ?? null) : null;

    const browseId = item.navigationCommand?.innertubeCommand?.browseEndpoint?.browseId;
    const browsePageType =
      item.navigationCommand?.innertubeCommand?.browseEndpoint?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType;

    let videoId: string | undefined;
    let playlistId: string | undefined;
    const commands = item.startPlaybackCommand?.serialCommand?.commands;
    if (Array.isArray(commands)) {
      for (const cmd of commands) {
        const watchEndpoint = cmd?.innertubeCommand?.watchEndpoint;
        if (watchEndpoint) {
          videoId = watchEndpoint.videoId;
          playlistId = watchEndpoint.playlistId;
          break;
        }
      }
    }

    let action: QuickAccessItem["action"];
    if (browseId?.startsWith("VL") || browsePageType === "MUSIC_PAGE_TYPE_PLAYLIST") {
      action = { type: "openPlaylist", browseId: browseId! };
    } else if (browsePageType === "MUSIC_PAGE_TYPE_ALBUM") {
      action = { type: "openAlbum", browseId: browseId! };
    } else if (videoId) {
      action = { type: "playTrack", trackId: videoId, playlistId };
    } else if (browseId) {
      action = { type: "openAlbum", browseId };
    } else {
      continue;
    }

    result.push({
      id: crypto.randomUUID(),
      title,
      thumbnailURL,
      action,
      artistName,
    });
  }

  return result;
}
