import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import type { SearchAlbum, SearchArtist, SearchPlaylist, SearchResultItem, Track, YouTubeMusicConfig } from "../types";
import { bestThumbnail, PROVIDER_ID } from "../utils";

const filterParams: Record<string, string> = {
  songs: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
  videos: "EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D",
  albums: "EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D",
  artists: "EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D",
  playlists: "EgWKAQIoAWoKEAkQChAFEAMQBA%3D%3D",
};

export async function handleSearch(
  config: YouTubeMusicConfig,
  query: string,
  filter?: string,
): Promise<SearchResultItem[]> {
  try {
    const body: any = { query };
    if (filter && filterParams[filter]) {
      body.params = decodeURIComponent(filterParams[filter]);
    }

    const data = await ytFetch("search", config, body);
    const items: SearchResultItem[] = [];

    const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
    for (const tab of tabs) {
      if (tab.tabRenderer?.selected === false) continue;
      const sections = tab.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

      for (const section of sections) {
        const classicShelfItems = section?.musicShelfRenderer?.contents;
        if (Array.isArray(classicShelfItems)) {
          for (const item of classicShelfItems) {
            const renderer = item.musicTwoColumnItemRenderer ?? item.musicResponsiveListItemRenderer;
            const parsed = renderer ? parseClassicSearchItem(renderer) : null;
            if (parsed) items.push(parsed);
          }
        }

        const isrContents = section?.itemSectionRenderer?.contents ?? [];
        for (const content of isrContents) {
          const model = content?.elementRenderer?.newElement?.type?.componentType?.model;
          if (!model) continue;

          const topResult =
            model?.musicTopResultCardShelfModel?.shelfData?.musicTopResultCardListItemHeaderData?.topResultItem;
          if (topResult) {
            const parsed = parseIOSSearchItem(topResult);
            if (parsed) items.push(parsed);
          }

          const shelfItems = model?.musicListItemShelfModel?.data?.items;
          if (Array.isArray(shelfItems)) {
            for (const item of shelfItems) {
              const parsed = parseIOSSearchItem(item);
              if (parsed) items.push(parsed);
            }
          }

          if (model?.musicListItemWrapperModel) {
            const parsed = parseIOSSearchItem(model);
            if (parsed) items.push(parsed);
          }
        }
      }
    }

    return items;
  } catch (e: any) {
    console.error("Search error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

export async function handleSearchSuggestions(config: YouTubeMusicConfig, query: string): Promise<string[]> {
  try {
    const data = await ytFetch("music/get_search_suggestions", config, { input: query });
    const texts: string[] = [];

    const contents = data?.contents ?? [];
    for (const section of contents) {
      const shelfContents = section?.sectionListRenderer?.contents ?? [];
      for (const shelf of shelfContents) {
        const items = shelf?.musicShelfRenderer?.contents ?? [];
        for (const item of items) {
          const suggestion = item?.searchSuggestionRenderer?.suggestion;
          if (suggestion?.runs) {
            texts.push(suggestion.runs.map((r: any) => r.text).join(""));
          }
        }
      }

      const sectionContents = section?.searchSuggestionsSectionRenderer?.contents ?? [];
      for (const item of sectionContents) {
        const suggestion = item?.searchSuggestionRenderer?.suggestion;
        if (suggestion?.runs) {
          texts.push(suggestion.runs.map((r: any) => r.text).join(""));
        }
      }
    }

    return texts;
  } catch (e: any) {
    console.error("Search suggestions error:", e.message);
    return [];
  }
}

function parseClassicSearchItem(item: any): SearchResultItem | null {
  const title = item.title?.runs?.map((r: any) => r.text).join("") ?? "";
  const subtitleRuns = item.subtitle?.runs ?? [];
  const subtitle = subtitleRuns.map((r: any) => r.text ?? "").join("");
  const thumbnailURL = bestThumbnail(item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? []);

  const watchEndpoint = item.navigationEndpoint?.watchEndpoint;
  const browseEndpoint = item.navigationEndpoint?.browseEndpoint;
  const browseId = browseEndpoint?.browseId;
  const pageType = browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;

  if (watchEndpoint?.videoId) {
    const duration = subtitleRuns
      .map((r: any) => r.text ?? "")
      .find((text: string) => /^\d+:\d{2}(:\d{2})?$/.test(text));
    const track: Track = {
      id: watchEndpoint.videoId,
      provider: PROVIDER_ID,
      title,
      artists: parseArtistsFromSubtitle(subtitle),
      album: null,
      duration: duration ?? null,
      durationSeconds: duration ? parseDurationSeconds(duration) : null,
      thumbnailURL,
      isExplicit: false,
    };
    return { type: "track", track };
  }

  if (pageType === "MUSIC_PAGE_TYPE_ALBUM") {
    const album: SearchAlbum = {
      id: browseId ?? "",
      provider: PROVIDER_ID,
      title,
      artists: parseArtistsFromSubtitle(subtitle),
      year: subtitle.match(/\b(19|20)\d{2}\b/)?.[0] ?? null,
      thumbnailURL,
      isExplicit: false,
    };
    return { type: "album", album };
  }

  if (pageType === "MUSIC_PAGE_TYPE_ARTIST") {
    const artist: SearchArtist = {
      id: browseId ?? "",
      provider: PROVIDER_ID,
      name: title,
      thumbnailURL,
      subscriberCount: subtitle || null,
    };
    return { type: "artist", artist };
  }

  if (pageType === "MUSIC_PAGE_TYPE_PLAYLIST" || browseId?.startsWith("VL")) {
    const playlist: SearchPlaylist = {
      id: browseId ?? "",
      provider: PROVIDER_ID,
      title,
      author: parseArtistsFromSubtitle(subtitle)[0]?.name ?? null,
      trackCount: null,
      thumbnailURL,
    };
    return { type: "playlist", playlist };
  }

  return null;
}

function parseIOSSearchItem(item: any): SearchResultItem | null {
  const data = item.musicListItemWrapperModel?.musicListItemData ?? item;
  const title = data.title ?? "";
  const subtitle = String(data.subtitle ?? "");
  const thumbnailSources = data.thumbnail?.image?.sources ?? [];
  const thumbnailURL = bestThumbnail(thumbnailSources);

  const cmd = data.onTap?.innertubeCommand;
  const browseId = cmd?.browseEndpoint?.browseId;
  const videoId = cmd?.watchEndpoint?.videoId;
  const pageType =
    cmd?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;

  if (videoId) {
    let album: Track["album"] = null;
    const menuItems = data.menuCommand?.innertubeCommand?.menuEndpoint?.menu?.menuRenderer?.items ?? [];
    for (const mi of menuItems) {
      const nav = mi.menuNavigationItemRenderer;
      if (!nav) continue;
      const browseEp = nav.navigationEndpoint?.browseEndpoint;
      const pageType = browseEp?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
      if (pageType === "MUSIC_PAGE_TYPE_ALBUM" && browseEp?.browseId) {
        album = { id: browseEp.browseId, name: "" };
        break;
      }
    }

    const track: Track = {
      id: videoId,
      provider: PROVIDER_ID,
      title,
      artists: parseArtistsFromSubtitle(subtitle),
      album,
      duration: null,
      durationSeconds: null,
      thumbnailURL,
      isExplicit: false,
    };
    return { type: "track", track };
  }

  if (pageType === "MUSIC_PAGE_TYPE_ALBUM") {
    const album: SearchAlbum = {
      id: browseId ?? "",
      provider: PROVIDER_ID,
      title,
      artists: parseArtistsFromSubtitle(subtitle),
      year: null,
      thumbnailURL,
      isExplicit: false,
    };
    return { type: "album", album };
  }

  if (pageType === "MUSIC_PAGE_TYPE_ARTIST") {
    const parts = subtitle.split(" • ");
    const count = parts.filter((p) => !TYPE_PREFIXES.includes(p.trim().toLowerCase())).join(" • ") || null;
    const artist: SearchArtist = {
      id: browseId ?? "",
      provider: PROVIDER_ID,
      name: title,
      thumbnailURL,
      subscriberCount: count,
    };
    return { type: "artist", artist };
  }

  if (pageType === "MUSIC_PAGE_TYPE_PLAYLIST" || browseId?.startsWith("VL")) {
    const playlist: SearchPlaylist = {
      id: browseId ?? "",
      provider: PROVIDER_ID,
      title,
      author: parseArtistsFromSubtitle(subtitle)[0]?.name ?? null,
      trackCount: null,
      thumbnailURL,
    };
    return { type: "playlist", playlist };
  }

  return null;
}

function parseDurationSeconds(duration: string): number | null {
  const parts = duration.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return null;
}

const NOISE_RE = /^(\d+:\d+|\d[\d.,]*[KMB]?\s*(plays|views|subscribers|listeners|monthly audience))$/i;
const TYPE_PREFIXES = ["song", "album", "video", "single", "ep", "playlist", "artist", "podcast", "episode"];

export async function lookupAlbumId(
  config: YouTubeMusicConfig,
  query: string,
  videoId: string,
): Promise<string | null> {
  try {
    const data = await ytFetch("search", config, { query });
    const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
    for (const tab of tabs) {
      const sections = tab.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
      for (const section of sections) {
        const isrContents = section?.itemSectionRenderer?.contents ?? [];
        for (const content of isrContents) {
          const model = content?.elementRenderer?.newElement?.type?.componentType?.model;
          if (!model) continue;
          const items = [
            model?.musicTopResultCardShelfModel?.shelfData?.musicTopResultCardListItemHeaderData?.topResultItem,
            ...(model?.musicListItemShelfModel?.data?.items ?? []),
          ].filter(Boolean);
          for (const item of items) {
            const itemVideoId = item?.onTap?.innertubeCommand?.watchEndpoint?.videoId;
            if (itemVideoId !== videoId) continue;
            const menuItems = item?.menuCommand?.innertubeCommand?.menuEndpoint?.menu?.menuRenderer?.items ?? [];
            for (const mi of menuItems) {
              const nav = mi.menuNavigationItemRenderer;
              if (!nav) continue;
              const browseEp = nav.navigationEndpoint?.browseEndpoint;
              const pt = browseEp?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
              if (pt === "MUSIC_PAGE_TYPE_ALBUM" && browseEp?.browseId) return browseEp.browseId;
            }
          }
        }
      }
    }
  } catch {}
  return null;
}

function parseArtistsFromSubtitle(subtitle: string): { id: string | null; name: string }[] {
  if (!subtitle) return [];
  const parts = subtitle.split(" • ");
  const artistParts = parts.filter((p) => {
    const trimmed = p.trim();
    return !NOISE_RE.test(trimmed) && !TYPE_PREFIXES.includes(trimmed.toLowerCase());
  });
  const artistPart = artistParts[0] ?? "";
  if (!artistPart) return [];
  return artistPart
    .split(", ")
    .filter(Boolean)
    .map((name) => ({ id: null, name: name.trim() }));
}
