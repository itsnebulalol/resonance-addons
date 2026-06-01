export const PROVIDER_ID = "com.resonance.ytm";

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
