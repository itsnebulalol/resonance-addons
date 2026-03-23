export { corsHeaders, errorResponse, formatDuration, json } from "@resonance-addons/sdk";

export const PROVIDER_ID = "com.resonance.ytm";
const ON_DEVICE_FETCH_MARKER = "__resonance_on_device_fetch__:";

export function isOnDeviceFetchSignal(error: unknown): boolean {
  if (typeof error === "string") {
    return error.includes(ON_DEVICE_FETCH_MARKER);
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes(ON_DEVICE_FETCH_MARKER);
}

export function bestThumbnail(thumbnails: { url: string; width: number; height: number }[]): string | null {
  if (!thumbnails?.length) return null;
  const sorted = [...thumbnails].sort((a, b) => b.width - a.width);
  return sorted[0]?.url ?? null;
}
