export const PROVIDER_ID = "net.itsnebula.youtubemusic";

export function bestThumbnail(thumbnails: { url: string; width: number; height: number }[]): string | null {
  if (!thumbnails?.length) return null;
  const sorted = [...thumbnails].sort((a, b) => b.width - a.width);
  const url = sorted[0]?.url ?? null;
  return url ? upscaleThumbnail(url) : null;
}

function upscaleThumbnail(url: string): string {
  if (/googleusercontent\.com|ggpht\.com/.test(url)) {
    if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, "=w1200-h1200");
    if (/=s\d+/.test(url)) return url.replace(/=s\d+/, "=s1200");
  }
  return url;
}

export function unwrapPlaylistPanelVideo(item: any, preferVideoId?: string): any | null {
  if (!item) return null;
  if (item.playlistPanelVideoRenderer) return item.playlistPanelVideoRenderer;
  const wrapper = item.playlistPanelVideoWrapperRenderer;
  if (!wrapper) return null;
  const primary = wrapper.primaryRenderer?.playlistPanelVideoRenderer ?? null;
  const candidates = [
    primary,
    ...(wrapper.counterpart ?? []).map((c: any) => c?.counterpartRenderer?.playlistPanelVideoRenderer),
  ].filter(Boolean);
  if (preferVideoId) {
    const seedMatch = candidates.find((r: any) => r.videoId === preferVideoId);
    if (seedMatch) return seedMatch;
  }
  const atv = candidates.find(
    (r: any) =>
      r.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig
        ?.musicVideoType === "MUSIC_VIDEO_TYPE_ATV",
  );
  return atv ?? primary ?? candidates[0] ?? null;
}
