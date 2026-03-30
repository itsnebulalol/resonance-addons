export const PROVIDER_ID = "com.resonance.ytm";

export function bestThumbnail(thumbnails: { url: string; width: number; height: number }[]): string | null {
  if (!thumbnails?.length) return null;
  const sorted = [...thumbnails].sort((a, b) => b.width - a.width);
  const url = sorted[0]?.url ?? null;
  return url ? upscaleThumbnail(url) : null;
}

function upscaleThumbnail(url: string): string {
  if (url.includes("lh3.googleusercontent.com") && /=w\d+-h\d+/.test(url)) {
    return url.replace(/=w\d+-h\d+/, "=w544-h544");
  }
  return url;
}
