import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import type { SearchAlbum, SearchArtist, SearchPlaylist, SearchResultItem, Track } from "../types";
import { PROVIDER_ID } from "../utils";

const filterParams: Record<string, string> = {
  songs: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
  albums: "EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D",
  artists: "EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D",
  playlists: "EgWKAQIoAWoKEAkQChAFEAMQBA%3D%3D",
};

export async function handleSearch(refreshToken: string, query: string, filter?: string): Promise<SearchResultItem[]> {
  try {
    const body: any = { query };
    if (filter && filterParams[filter]) {
      body.params = decodeURIComponent(filterParams[filter]);
    }

    const data = await ytFetch("search", refreshToken, body);
    const items: SearchResultItem[] = [];

    const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
    for (const tab of tabs) {
      if (tab.tabRenderer?.selected === false) continue;
      const sections = tab.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

      for (const section of sections) {
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

export async function handleSearchSuggestions(refreshToken: string, query: string): Promise<string[]> {
  try {
    const data = await ytFetch("music/get_search_suggestions", refreshToken, { input: query });
    const texts: string[] = [];

    const contents = data?.contents ?? [];
    for (const section of contents) {
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

function parseIOSSearchItem(item: any): SearchResultItem | null {
  const title = item.title ?? "";
  const subtitle = String(item.subtitle ?? "");
  const thumbnailSources = item.thumbnail?.image?.sources ?? [];
  const thumbnailURL =
    thumbnailSources.length > 0 ? (thumbnailSources[thumbnailSources.length - 1]?.url ?? null) : null;

  const cmd = item.onTap?.innertubeCommand;
  const browseId = cmd?.browseEndpoint?.browseId;
  const videoId = cmd?.watchEndpoint?.videoId;
  const pageType =
    cmd?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;

  if (videoId) {
    let album: Track["album"] = null;
    const menuItems = item.menuCommand?.innertubeCommand?.menuEndpoint?.menu?.menuRenderer?.items ?? [];
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

const NOISE_RE = /^(\d+:\d+|\d[\d.,]*[KMB]?\s*(plays|views|subscribers|listeners|monthly audience))$/i;
const TYPE_PREFIXES = ["song", "album", "video", "single", "ep", "playlist", "artist", "podcast", "episode"];

export async function lookupAlbumId(refreshToken: string, query: string, videoId: string): Promise<string | null> {
  try {
    const data = await ytFetch("search", refreshToken, { query });
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
