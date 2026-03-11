import type { AddonConfig } from "./types";

export { corsHeaders, errorResponse, formatDuration, json } from "@resonance-addons/shared";

import { parseConfig as decodeConfig } from "@resonance-addons/shared";

const PROVIDER_ID = "com.resonance.ytm";
export { PROVIDER_ID };

export function parseConfig(configStr: string): AddonConfig {
  const config = decodeConfig<AddonConfig>(configStr);
  if (!config.refreshToken) throw new Error("Missing refreshToken in config");
  return config;
}

export function bestThumbnail(thumbnails: { url: string; width: number; height: number }[]): string | null {
  if (!thumbnails?.length) return null;
  const sorted = [...thumbnails].sort((a, b) => b.width - a.width);
  return sorted[0]?.url ?? null;
}
