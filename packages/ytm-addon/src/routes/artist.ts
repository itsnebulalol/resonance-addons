import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import type { SearchAlbum, SearchArtist, SearchPlaylist, Track } from "../types";
import { bestThumbnail, PROVIDER_ID } from "../utils";

interface ArtistDetail {
  id: string;
  name: string;
  thumbnailURL: string | null;
  subtitle: string | null;
  topTracks: Track[];
  albums: SearchAlbum[];
  singles: SearchAlbum[];
  playlists: SearchPlaylist[];
  relatedArtists: SearchArtist[];
}

export async function handleArtist(refreshToken: string, browseId: string): Promise<ArtistDetail> {
  try {
    const data = await ytFetch("browse", refreshToken, { browseId });

    const immersiveHeader = data?.header?.musicImmersiveHeaderRenderer;
    const visualHeader = data?.header?.musicVisualHeaderRenderer;
    const header = immersiveHeader ?? visualHeader;

    const name = header?.title?.runs?.[0]?.text ?? "";
    const thumbSources =
      header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
      header?.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
      [];
    const thumbnailURL = bestThumbnail(thumbSources);

    const subscriberText =
      header?.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText?.runs?.[0]?.text ?? null;

    const sections =
      data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
        ?.contents ?? [];

    const topTracks: Track[] = [];
    const albums: SearchAlbum[] = [];
    const singles: SearchAlbum[] = [];
    const playlists: SearchPlaylist[] = [];
    const relatedArtists: SearchArtist[] = [];

    for (const sec of sections) {
      const sectionContents = sec?.itemSectionRenderer?.contents ?? [];
      for (const content of sectionContents) {
        const model = content?.elementRenderer?.newElement?.type?.componentType?.model;
        if (!model) continue;

        const listCarousel = model.musicListItemCarouselModel;
        if (listCarousel) {
          for (const item of listCarousel.items ?? []) {
            const videoId = item.onTap?.innertubeCommand?.watchEndpoint?.videoId;
            if (!videoId) continue;
            const subtitle: string = item.subtitle ?? "";
            const artistPart = subtitle.split(" • ")[0] ?? "";
            const artists = artistPart.split(" & ").map((n: string) => ({ id: null, name: n.trim() }));
            const thumbSources = item.thumbnail?.image?.sources ?? [];
            topTracks.push({
              id: videoId,
              provider: PROVIDER_ID,
              title: item.title ?? "",
              artists,
              album: null,
              duration: null,
              durationSeconds: null,
              thumbnailURL: bestThumbnail(thumbSources),
              isExplicit: (item.musicInlineBadges ?? []).some(
                (b: any) =>
                  b.iconName === "yt_fill_explicit_24pt" ||
                  b.musicInlineBadgeRenderer?.icon?.iconType === "MUSIC_EXPLICIT_BADGE",
              ),
            });
          }
          continue;
        }

        const gridCarousel = model.musicGridItemCarouselModel;
        if (!gridCarousel) continue;

        const items = gridCarousel.shelf?.items ?? gridCarousel.data?.items ?? [];
        for (const item of items) {
          const browseEndpoint = item.onTap?.innertubeCommand?.browseEndpoint;
          const pageType =
            browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
          const itemId = browseEndpoint?.browseId;
          if (!itemId) continue;

          const itemTitle = item.title ?? "";
          const itemSubtitle = item.subtitle ?? "";
          const itemThumbSources = item.thumbnail?.image?.sources ?? [];
          const itemThumb = bestThumbnail(itemThumbSources);

          if (pageType === "MUSIC_PAGE_TYPE_ALBUM") {
            const yearMatch = itemSubtitle.match(/\b(19|20)\d{2}\b/);
            const isSingle = /single/i.test(itemSubtitle);

            const album: SearchAlbum = {
              id: itemId,
              provider: PROVIDER_ID,
              title: itemTitle,
              artists: [{ id: browseId, name }],
              year: yearMatch ? yearMatch[0] : null,
              thumbnailURL: itemThumb,
              isExplicit: false,
            };

            if (isSingle) {
              singles.push(album);
            } else {
              albums.push(album);
            }
          } else if (pageType === "MUSIC_PAGE_TYPE_ARTIST") {
            relatedArtists.push({
              id: itemId,
              provider: PROVIDER_ID,
              name: itemTitle,
              thumbnailURL: itemThumb,
              subscriberCount: itemSubtitle || null,
            });
          } else if (pageType === "MUSIC_PAGE_TYPE_PLAYLIST") {
            playlists.push({
              id: itemId,
              provider: PROVIDER_ID,
              title: itemTitle,
              author: null,
              trackCount: null,
              thumbnailURL: itemThumb,
            });
          }
        }
      }
    }

    const detail: ArtistDetail = {
      id: browseId,
      name,
      thumbnailURL,
      subtitle: subscriberText,
      topTracks,
      albums,
      singles,
      playlists,
      relatedArtists,
    };

    return detail;
  } catch (e: any) {
    console.error("Artist error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}
