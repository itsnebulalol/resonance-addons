import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import type { SearchAlbum, SearchArtist, SearchPlaylist, Track, YouTubeMusicConfig } from "../types";
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

export async function handleArtist(config: YouTubeMusicConfig, browseId: string): Promise<ArtistDetail> {
  try {
    const data = await ytFetch("browse", config, { browseId });

    const immersiveHeader = data?.header?.musicImmersiveHeaderRenderer;
    const visualHeader = data?.header?.musicVisualHeaderRenderer;
    const elementHeader =
      data?.header?.musicElementHeaderRenderer?.elementRenderer?.elementRenderer?.newElement?.type?.componentType?.model
        ?.youtubeModel?.musicPageHeaderModel;
    const header = immersiveHeader ?? visualHeader;

    const name = header?.title?.runs?.[0]?.text ?? elementHeader?.title ?? "";
    const thumbSources =
      header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
      header?.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
      elementHeader?.backgroundImageData?.image?.sources ??
      [];
    const thumbnailURL = bestThumbnail(thumbSources);

    const subscriberText =
      header?.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText?.runs?.[0]?.text ??
      elementHeader?.monthlyListenerCount?.content ??
      null;

    const sections =
      data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
        ?.contents ?? [];

    const topTracks: Track[] = [];
    const albums: SearchAlbum[] = [];
    const singles: SearchAlbum[] = [];
    const playlists: SearchPlaylist[] = [];
    const relatedArtists: SearchArtist[] = [];

    const safeSeeAllEndpoints: any[] = [];

    // 1. Process the standard preview items & grab endpoints
    for (const sec of sections) {
      const sectionContents = sec?.itemSectionRenderer?.contents ?? [];
      for (const content of sectionContents) {
        const model = content?.elementRenderer?.newElement?.type?.componentType?.model;
        if (!model) continue;

        // Grab ALL "See All" endpoints blindly (we will filter the junk later by year!)
        JSON.stringify(model, (k, v) => {
          if (k === 'browseEndpoint' && v?.browseId && v?.params) {
            safeSeeAllEndpoints.push(v);
          }
          return v;
        });

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
            
            // --- THE SILVER BULLET FILTER ---
            // If the item doesn't have a 4-digit year, it's a compilation/feature. Skip it!
            if (!yearMatch) continue;

            const isSingle = /single/i.test(itemSubtitle);

            const album: SearchAlbum = {
              id: itemId,
              provider: PROVIDER_ID,
              title: itemTitle,
              artists: [{ id: browseId, name }],
              year: yearMatch[0],
              thumbnailURL: itemThumb,
              isExplicit: false,
            };

            if (isSingle) {
              if (!singles.some(x => x.id === itemId)) singles.push(album);
            } else {
              if (!albums.some(x => x.id === itemId)) albums.push(album);
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

    // 2. The Spider Pagination Fix
    try {
      const uniqueParams = new Set<string>();
      const uniqueSeeAlls = safeSeeAllEndpoints.filter(ep => {
        if (uniqueParams.has(ep.params)) return false;
        uniqueParams.add(ep.params);
        return true;
      });

      await Promise.all(uniqueSeeAlls.map(async (ep) => {
        try {
          let currentRes = await ytFetch("browse", config, { browseId: ep.browseId, params: ep.params });
          let pagesFetched = 0;

          while (currentRes && pagesFetched < 4) {
            pagesFetched++;
            let nextContinuationToken: string | null = null;

            JSON.stringify(currentRes, (k, v) => {
              if (k === 'nextContinuationData' && v?.continuation) {
                nextContinuationToken = v.continuation;
              }

              if (v && typeof v === 'object') {
                const ep2 = v.navigationEndpoint?.browseEndpoint ?? v.onTap?.innertubeCommand?.browseEndpoint;
                if (ep2?.browseId && ep2?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === "MUSIC_PAGE_TYPE_ALBUM") {
                  const itemId = ep2.browseId;
                  const itemTitle = typeof v.title === 'string' ? v.title : v.title?.runs?.[0]?.text ?? "";
                  const itemSubtitle = typeof v.subtitle === 'string' ? v.subtitle : Array.isArray(v.subtitle?.runs) ? v.subtitle.runs.map((x: any) => x.text).join("") : v.subtitle ?? "";

                  if (itemTitle) {
                    const thumbSources = v.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? v.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? v.thumbnail?.image?.sources ?? [];
                    const yearMatch = itemSubtitle.match(/\b(19|20)\d{2}\b/);
                    
                    // --- THE SILVER BULLET FILTER (SPIDER EDITION) ---
                    // Even if the Spider is in the "Appears On" section, it won't save anything without a year!
                    if (!yearMatch) return v;

                    const isSingle = /single|ep/i.test(itemSubtitle) || /single|ep/i.test(itemTitle);

                    const album: SearchAlbum = {
                      id: itemId,
                      provider: PROVIDER_ID,
                      title: itemTitle,
                      artists: [{ id: browseId, name }],
                      year: yearMatch[0],
                      thumbnailURL: bestThumbnail(thumbSources),
                      isExplicit: false,
                    };

                    if (isSingle) {
                      if (!singles.some(x => x.id === itemId)) singles.push(album);
                    } else {
                      if (!albums.some(x => x.id === itemId)) albums.push(album);
                    }
                  }
                }
              }
              return v;
            });

            if (nextContinuationToken) {
              currentRes = await ytFetch("browse", config, { continuation: nextContinuationToken });
            } else {
              break; 
            }
          }
        } catch (err) {
          console.error("Pagination internal error:", err);
        }
      }));
    } catch (err) {
      console.error("Pagination top level error:", err);
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
