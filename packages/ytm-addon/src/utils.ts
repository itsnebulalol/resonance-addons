export { corsHeaders, errorResponse, formatDuration, json } from "@resonance-addons/sdk";

export const PROVIDER_ID = "com.resonance.ytm";

export function bestThumbnail(thumbnails: { url: string; width: number; height: number }[]): string | null {
  if (!thumbnails?.length) return null;
  const sorted = [...thumbnails].sort((a, b) => b.width - a.width);
  return sorted[0]?.url ?? null;
}
