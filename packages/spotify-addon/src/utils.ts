export { corsHeaders, errorResponse, json } from "@resonance-addons/sdk";

export const PROVIDER_ID = "com.resonance.spotify";

export function uriToId(uri: string): string {
  return uri.split(":").pop() ?? uri;
}

export function bestImage(sources: { url: string; width?: number }[]): string | null {
  if (!sources.length) return null;
  return sources.reduce((best, s) => ((s.width ?? 0) > (best.width ?? 0) ? s : best)).url ?? null;
}

export function formatDurationMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatDurationSec(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
