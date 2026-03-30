import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import type { AlbumDetail, Track } from "../types";
import { bestThumbnail, PROVIDER_ID } from "../utils";

export async function handleAlbum(refreshToken: string, browseId: string): Promise<AlbumDetail> {
  try {
    const data = await ytFetch("browse", refreshToken, { browseId });

    const headerRenderer = data?.header?.musicElementHeaderRenderer;
    const bgModel =
      headerRenderer?.elementRenderer?.elementRenderer?.newElement?.type?.componentType?.model
        ?.musicBlurredBackgroundHeaderModel;
    const hData = bgModel?.data ?? {};

    const title = hData.title ?? headerRenderer?.title?.runs?.[0]?.text ?? "";

    const artistName = hData.straplineData?.textLine1?.content ?? "";
    const artists = artistName ? artistName.split(", ").map((name: string) => ({ id: null, name: name.trim() })) : [];

    const textLine2 = hData.straplineData?.textLine2?.content ?? "";
    const yearMatch = textLine2.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : null;

    const trackCountMatch = textLine2.match(/(\d+)\s+song/i);
    const trackCount = trackCountMatch ? `${trackCountMatch[1]} songs` : null;

    const thumbSources = hData.primaryImage?.sources ?? [];
    const thumbnailUrl = bestThumbnail(thumbSources);

    const sections =
      data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
        ?.contents ?? [];

    const tracks: Track[] = [];
    let playlistId: string | null = null;

    for (const sec of sections) {
      const content = sec?.itemSectionRenderer?.contents?.[0];
      if (!content?.elementRenderer) continue;
      const model = content.elementRenderer.newElement?.type?.componentType?.model;
      const listItem = model?.musicListItemWrapperModel?.musicListItemData;
      if (!listItem) continue;

      const watchEndpoint = listItem.onTap?.innertubeCommand?.watchEndpoint;
      const videoId = watchEndpoint?.videoId;
      if (!videoId) continue;

      if (!playlistId && watchEndpoint.playlistId) {
        playlistId = watchEndpoint.playlistId;
      }

      const trackTitle = listItem.title ?? "";
      const subtitle = listItem.subtitle ?? "";
      const trackArtists = parseTrackArtists(subtitle);
      const duration = parseDuration(subtitle);

      const trackThumb = listItem.thumbnail?.image?.sources ?? [];

      tracks.push({
        id: videoId,
        provider: PROVIDER_ID,
        title: trackTitle,
        artists: trackArtists.length > 0 ? trackArtists : artists,
        album: { id: browseId, name: title },
        duration: duration.text,
        durationSeconds: duration.seconds,
        thumbnailURL: bestThumbnail(trackThumb) ?? thumbnailUrl,
        isExplicit: false,
      });
    }

    const detail: AlbumDetail = {
      id: browseId,
      title,
      artists,
      year,
      trackCount: trackCount ?? (tracks.length > 0 ? `${tracks.length} songs` : null),
      duration: null,
      thumbnailURL: thumbnailUrl,
      tracks,
      playlistId,
    };

    return detail;
  } catch (e: any) {
    console.error("Album error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}

function parseTrackArtists(subtitle: string): { id: string | null; name: string }[] {
  if (!subtitle) return [];
  // "Artist1, Artist2 • 4:48 • 17M plays"
  const parts = subtitle.split(" • ");
  const artistPart = parts[0] ?? "";
  return artistPart
    .split(", ")
    .filter(Boolean)
    .map((name) => ({ id: null, name: name.trim() }));
}

function parseDuration(subtitle: string): { text: string | null; seconds: number | null } {
  const parts = subtitle.split(" • ");
  for (const part of parts) {
    const trimmed = part.trim();
    if (/^\d+:\d{2}$/.test(trimmed)) {
      const [m, s] = trimmed.split(":").map(Number);
      return { text: trimmed, seconds: (m ?? 0) * 60 + (s ?? 0) };
    }
    if (/^\d+:\d{2}:\d{2}$/.test(trimmed)) {
      const [h, m, s] = trimmed.split(":").map(Number);
      return { text: trimmed, seconds: (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0) };
    }
  }
  return { text: null, seconds: null };
}
