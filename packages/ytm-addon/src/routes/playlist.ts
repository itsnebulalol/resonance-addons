import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import type { PlaylistDetail, Track, TrackPage } from "../types";
import { bestThumbnail, PROVIDER_ID } from "../utils";

function extractNextContinuation(continuations: any[] | undefined): string | null {
  for (const c of continuations ?? []) {
    if (c.nextContinuationData?.continuation) return c.nextContinuationData.continuation;
  }
  return null;
}

export async function handlePlaylist(refreshToken: string, browseId: string): Promise<PlaylistDetail> {
  try {
    const actualBrowseId = browseId.startsWith("VL") ? browseId : `VL${browseId}`;
    const data = await ytFetch("browse", refreshToken, { browseId: actualBrowseId });

    const headerRenderer = data?.header?.musicElementHeaderRenderer;
    const bgModel =
      headerRenderer?.elementRenderer?.elementRenderer?.newElement?.type?.componentType?.model
        ?.musicBlurredBackgroundHeaderModel;
    const hData = bgModel?.data ?? {};

    const title = hData.title ?? headerRenderer?.title?.runs?.[0]?.text ?? "";
    const author = hData.straplineData?.textLine1?.content ?? null;
    const description = hData.description ?? null;

    const textLine2 = hData.straplineData?.textLine2?.content ?? "";
    const trackCountMatch = textLine2.match(/(\d+)\s+(?:song|track)/i);
    const trackCount = trackCountMatch ? `${trackCountMatch[1]} songs` : null;

    const thumbSources = hData.primaryImage?.sources ?? [];
    const thumbnailUrl = bestThumbnail(thumbSources);

    const sectionContents =
      data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
        ?.contents ?? [];

    const tracks: Track[] = [];
    let continuation: string | null = null;
    let shelfTrackCount: string | null = null;

    for (const sec of sectionContents) {
      const shelf = sec.musicPlaylistShelfRenderer;
      if (shelf) {
        for (const item of shelf.contents ?? []) {
          const renderer = item.musicTwoColumnItemRenderer ?? item.musicResponsiveListItemRenderer;
          if (renderer) {
            const track = parseTwoColumnTrack(renderer, thumbnailUrl);
            if (track) tracks.push(track);
          }
        }
        continuation = extractNextContinuation(shelf.continuations);
        const footerText = shelf.subFooter?.messageRenderer?.subtext?.messageSubtextRenderer?.text?.runs?.[0]?.text as
          | string
          | undefined;
        if (footerText) {
          const m = footerText.match(/(\d[\d,]*)\s+(?:song|track)/i);
          if (m) shelfTrackCount = `${m[1]!.replace(/,/g, "")} songs`;
        }
        continue;
      }

      const content = sec.itemSectionRenderer?.contents?.[0];
      if (content?.elementRenderer) {
        const model = content.elementRenderer.newElement?.type?.componentType?.model;
        const listItem = model?.musicListItemWrapperModel?.musicListItemData;
        if (listItem) {
          const track = parseListItemTrack(listItem, thumbnailUrl);
          if (track) tracks.push(track);
        }
      }
    }

    const detail: PlaylistDetail = {
      id: browseId,
      title,
      author,
      description,
      trackCount: trackCount ?? shelfTrackCount ?? (tracks.length > 0 ? `${tracks.length} songs` : null),
      thumbnailURL: thumbnailUrl,
      tracks,
      continuation,
    };

    return detail;
  } catch (e: any) {
    console.error("Playlist error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

export async function handlePlaylistMore(
  refreshToken: string,
  browseId: string,
  continuation: string,
): Promise<TrackPage> {
  try {
    void browseId;
    const contData = await ytFetch("browse", refreshToken, { continuation });
    const contContents = contData?.continuationContents?.musicPlaylistShelfContinuation;
    if (!contContents) throw new AddonError("No continuation contents", 404);

    const tracks: Track[] = [];
    for (const item of contContents.contents ?? []) {
      const renderer = item.musicTwoColumnItemRenderer ?? item.musicResponsiveListItemRenderer;
      if (renderer) {
        const track = parseTwoColumnTrack(renderer, null);
        if (track) tracks.push(track);
      }
    }

    const nextContinuation = extractNextContinuation(contContents.continuations);
    const page: TrackPage = { tracks, continuation: nextContinuation };
    return page;
  } catch (e: any) {
    console.error("Playlist more error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

function parseTwoColumnTrack(renderer: any, fallbackThumb: string | null): Track | null {
  const videoId = renderer.navigationEndpoint?.watchEndpoint?.videoId;
  if (!videoId) return null;

  const title = renderer.title?.runs?.[0]?.text ?? "";
  const subtitleRuns = renderer.subtitle?.runs ?? [];

  const artists: Track["artists"] = [];
  let durationText: string | null = null;
  for (const run of subtitleRuns) {
    const text = run.text ?? "";
    if (text === " • " || text === " • ") continue;
    if (/^\d+:\d{2}(:\d{2})?$/.test(text)) {
      durationText = text;
      continue;
    }
    const aid = run.navigationEndpoint?.browseEndpoint?.browseId ?? null;
    if (artists.length === 0 || aid) {
      artists.push({ id: aid, name: text });
    }
  }

  let durationSeconds: number | null = null;
  if (durationText) {
    const parts = durationText.split(":").map(Number);
    if (parts.length === 2) durationSeconds = (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
    else if (parts.length === 3) durationSeconds = (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }

  const thumbnails = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];

  return {
    id: videoId,
    provider: PROVIDER_ID,
    title,
    artists,
    album: null,
    duration: durationText,
    durationSeconds,
    thumbnailURL: bestThumbnail(thumbnails) ?? fallbackThumb,
    isExplicit: false,
  };
}

function parseListItemTrack(listItem: any, fallbackThumb: string | null): Track | null {
  const videoId = listItem.onTap?.innertubeCommand?.watchEndpoint?.videoId;
  if (!videoId) return null;

  const title = listItem.title ?? "";
  const subtitle = listItem.subtitle ?? "";
  const parts = subtitle.split(" • ");
  const artistPart = parts[0] ?? "";
  const artists = artistPart
    .split(", ")
    .filter(Boolean)
    .map((name: string) => ({ id: null, name: name.trim() }));

  let durationText: string | null = null;
  let durationSeconds: number | null = null;
  for (const part of parts) {
    const trimmed = part.trim();
    if (/^\d+:\d{2}(:\d{2})?$/.test(trimmed)) {
      durationText = trimmed;
      const dp = trimmed.split(":").map(Number);
      if (dp.length === 2) durationSeconds = (dp[0] ?? 0) * 60 + (dp[1] ?? 0);
      else if (dp.length === 3) durationSeconds = (dp[0] ?? 0) * 3600 + (dp[1] ?? 0) * 60 + (dp[2] ?? 0);
      break;
    }
  }

  const thumbSources = listItem.thumbnail?.image?.sources ?? [];

  return {
    id: videoId,
    provider: PROVIDER_ID,
    title,
    artists,
    album: null,
    duration: durationText,
    durationSeconds,
    thumbnailURL: bestThumbnail(thumbSources) ?? fallbackThumb,
    isExplicit: false,
  };
}
