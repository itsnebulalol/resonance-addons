export { corsHeaders, errorResponse, formatDuration, json } from "@resonance-addons/sdk";

export const PROVIDER_ID = "com.resonance.torbox";

export function formatSize(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
