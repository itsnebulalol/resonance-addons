import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import type { LyricsData, LyricsLine } from "../types";

export async function handleLyrics(
  refreshToken: string,
  videoId?: string,
  title?: string,
  artist?: string,
): Promise<LyricsData | null> {
  try {
    let targetVideoId = videoId;

    if (!targetVideoId && title) {
      const query = artist ? `${title} ${artist}` : title;
      const searchData = await ytFetch("search", refreshToken, { query, params: "EgWKAQIIAWoKEAkQBRAKEAMQBA==" });
      const tabs = searchData?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
      for (const tab of tabs) {
        const sections = tab.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
        for (const section of sections) {
          const items = section?.itemSectionRenderer?.contents ?? [];
          for (const content of items) {
            const shelfItems =
              content?.elementRenderer?.newElement?.type?.componentType?.model?.musicListItemShelfModel?.data?.items;
            if (Array.isArray(shelfItems) && shelfItems.length > 0) {
              targetVideoId = shelfItems[0]?.onTap?.innertubeCommand?.watchEndpoint?.videoId;
              break;
            }
          }
          if (targetVideoId) break;
        }
        if (targetVideoId) break;
      }
    }

    if (!targetVideoId) {
      return null;
    }

    const lyrics = await fetchLyrics(refreshToken, targetVideoId);
    return lyrics;
  } catch (e: any) {
    console.error("Lyrics error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

async function fetchLyrics(refreshToken: string, videoId: string): Promise<LyricsData | null> {
  try {
    const nextData = await ytFetch("next", refreshToken, { videoId, isAudioOnly: true });

    const tabs =
      nextData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer
        ?.tabs ?? [];

    let lyricsId: string | null = null;
    for (const tab of tabs) {
      const endpoint = tab?.tabRenderer?.endpoint;
      const pageType =
        endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
      if (pageType === "MUSIC_PAGE_TYPE_TRACK_LYRICS") {
        lyricsId = endpoint.browseEndpoint.browseId;
        break;
      }
    }

    if (!lyricsId) return null;

    const browseData = await ytFetch("browse", refreshToken, { browseId: lyricsId });

    const timedModel =
      browseData?.contents?.elementRenderer?.newElement?.type?.componentType?.model?.timedLyricsModel?.lyricsData;

    if (timedModel?.timedLyricsData) {
      const timedLines = timedModel.timedLyricsData;
      const linesArray = Array.isArray(timedLines) ? timedLines : Object.values(timedLines);

      const lines: LyricsLine[] = linesArray.map((line: any, i: number) => ({
        id: i,
        startTimeMs: parseInt(line.cueRange?.startTimeMilliseconds ?? "0", 10),
        endTimeMs: parseInt(line.cueRange?.endTimeMilliseconds ?? "0", 10) || null,
        text: line.lyricLine ?? "",
        words: [],
      }));

      return { syncType: "lineSynced", lines };
    }

    const plainText =
      browseData?.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer?.description?.runs?.[0]
        ?.text;
    if (plainText) {
      const lines: LyricsLine[] = plainText.split("\n").map((line: string, i: number) => ({
        id: i,
        startTimeMs: 0,
        endTimeMs: null,
        text: line,
        words: [],
      }));
      return { syncType: "unsynced", lines };
    }

    return null;
  } catch (e: any) {
    console.error("Lyrics error:", e.message);
    return null;
  }
}
