import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import type { Track } from "../types";
import { PROVIDER_ID } from "../utils";

export async function handleRelated(refreshToken: string, browseId: string): Promise<Track[]> {
  try {
    console.log(`[related] Fetching related for ${browseId}`);
    const data = await ytFetch("browse", refreshToken, { browseId });

    const tracks: Track[] = [];

    const sectionPath =
      data?.contents?.sectionListRenderer?.contents ??
      data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
        ?.contents ??
      [];

    for (const section of sectionPath) {
      const isr = section.itemSectionRenderer;
      if (!isr?.contents) continue;

      for (const content of isr.contents) {
        const model = content?.elementRenderer?.newElement?.type?.componentType?.model;
        if (!model) continue;

        const m = model.musicListItemCarouselModel ?? model.musicGridItemCarouselModel;
        const items = m?.items ?? m?.shelf?.items ?? [];
        for (const item of items) {
          const track = parseIOSRelatedItem(item);
          if (track) tracks.push(track);
        }
      }
    }

    console.log(`[related] Got ${tracks.length} tracks`);
    return tracks;
  } catch (e: any) {
    console.error("Related error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

export async function handleRelatedForTrack(refreshToken: string, videoId: string): Promise<Track[]> {
  try {
    console.log(`[related] Fetching related for track ${videoId}`);
    const data = await ytFetch("next", refreshToken, {
      videoId,
      playlistId: `RDAMVM${videoId}`,
      isAudioOnly: true,
      enablePersistentPlaylistPanel: true,
      watchEndpointMusicSupportedConfigs: {
        watchEndpointMusicConfig: {
          hasPersistentPlaylistPanel: true,
          musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
        },
      },
    });

    const tabs =
      data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;

    let relatedBrowseId: string | null = null;
    if (tabs) {
      for (const tab of tabs.slice(2)) {
        const browseId = tab?.tabRenderer?.endpoint?.browseEndpoint?.browseId;
        if (browseId) {
          relatedBrowseId = browseId;
          break;
        }
      }
    }

    if (!relatedBrowseId) {
      console.log(`[related] No related browse ID found for ${videoId}`);
      return [];
    }

    return handleRelated(refreshToken, relatedBrowseId);
  } catch (e: any) {
    console.error("Related for track error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

function parseIOSRelatedItem(item: any): Track | null {
  const videoId = item.onTap?.innertubeCommand?.watchEndpoint?.videoId;
  if (!videoId) return null;
  const title = item.title ?? "";
  const subtitle = item.subtitle ?? "";
  const artists = subtitle ? [{ id: null as string | null, name: subtitle.split(" • ")[0]?.trim() ?? subtitle }] : [];
  const thumbnailSources = item.thumbnail?.image?.sources ?? [];
  const thumbnailURL =
    thumbnailSources.length > 0 ? (thumbnailSources[thumbnailSources.length - 1]?.url ?? null) : null;

  return {
    id: videoId,
    provider: PROVIDER_ID,
    title,
    artists,
    album: null,
    duration: null,
    durationSeconds: null,
    thumbnailURL,
    isExplicit: false,
  };
}
