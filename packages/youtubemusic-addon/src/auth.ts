const CLIENT_ID = "755973059757-iigsfdoqt2c4qm209soqp2dlrh33almr.apps.googleusercontent.com";
const TOKEN_URL = "https://oauthaccountmanager.googleapis.com/v1/issuetoken";
const INNERTUBE_BASE = "https://music.youtube.com/youtubei/v1";
const IOS_MUSIC_VERSION = "9.06.4";
const IOS_OS_VERSION = "26.2.1";
const IOS_DEVICE_MODEL = "iPhone18,4";
const MOBILE_UA = `com.google.ios.youtubemusic/${IOS_MUSIC_VERSION} iSL/3.4 iPhone/${IOS_OS_VERSION} hw/iPhone18_4 (gzip)`;

import type { YouTubeMusicConfig } from "./types";

export interface RegionContext {
  gl: string;
  hl: string;
}

export const DEFAULT_REGION_CONTEXT: RegionContext = { gl: "US", hl: "en" };

export function normalizeRegionContext(config: Pick<YouTubeMusicConfig, "gl" | "hl">): RegionContext {
  return {
    gl: config.gl?.trim().toUpperCase() || DEFAULT_REGION_CONTEXT.gl,
    hl: config.hl?.trim() || DEFAULT_REGION_CONTEXT.hl,
  };
}

const tokenCache = new Map<string, { token: string; expires: number }>();
const tokenInFlight = new Map<string, Promise<string>>();
const responseCache = new Map<string, { data: unknown; expiresAt: number }>();

const RESPONSE_CACHE_TTL_MS = 15_000;
const RESPONSE_CACHE_MAX_ENTRIES = 32;

const deviceIds = new Map<string, string>();

function makeResponseCacheKey(refreshToken: string, endpoint: string, body: Record<string, any>): string {
  return `${refreshToken}::${endpoint}::${JSON.stringify(body)}`;
}

function pruneResponseCache(now = Date.now()): void {
  for (const [key, entry] of responseCache.entries()) {
    if (entry.expiresAt <= now) {
      responseCache.delete(key);
    }
  }

  while (responseCache.size > RESPONSE_CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (!oldest) {
      break;
    }
    responseCache.delete(oldest);
  }
}

function getCachedResponse(key: string): unknown | undefined {
  const entry = responseCache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return undefined;
  }
  return structuredClone(entry.data);
}

function setCachedResponse(key: string, data: unknown): void {
  pruneResponseCache();
  responseCache.delete(key);
  responseCache.set(key, {
    data: structuredClone(data),
    expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
  });
  pruneResponseCache();
}

export function invalidateResponseCache(refreshToken: string): void {
  for (const key of responseCache.keys()) {
    if (key.startsWith(`${refreshToken}::`)) {
      responseCache.delete(key);
    }
  }
}

function getDeviceId(refreshToken: string): string {
  let id = deviceIds.get(refreshToken);
  if (!id) {
    id = crypto.randomUUID();
    deviceIds.set(refreshToken, id);
  }
  return id;
}

export async function mintAccessToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expires > Date.now()) {
    return cached.token;
  }

  const inFlight = tokenInFlight.get(refreshToken);
  if (inFlight) return inFlight;

  const promise = requestAccessToken(refreshToken);
  tokenInFlight.set(refreshToken, promise);
  try {
    return await promise;
  } finally {
    tokenInFlight.delete(refreshToken);
  }
}

async function requestAccessToken(refreshToken: string): Promise<string> {
  const scopes = ["https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.force-ssl"].join(
    " ",
  );

  const body = new URLSearchParams({
    app_id: "com.google.ios.youtubemusic",
    client_id: CLIENT_ID,
    device_id: getDeviceId(refreshToken),
    hl: "en-US",
    lib_ver: "3.4",
    response_type: "token",
    scope: scopes,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${refreshToken}`,
      "User-Agent": "com.google.ios.youtubemusic/9.06.4 iSL/3.4 iPhone/26.2.1 hw/iPhone18_4 (gzip)",
      "X-OAuth-Client-ID": CLIENT_ID,
      Accept: "*/*",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { token: string; expiresIn?: string };
  const expiresIn = data.expiresIn ? parseInt(data.expiresIn, 10) : 3600;
  tokenCache.set(refreshToken, {
    token: data.token,
    expires: Date.now() + (expiresIn - 60) * 1000,
  });

  console.log(`[auth] Minted access token (expires in ${expiresIn}s)`);
  return data.token;
}

export function buildIOSContext(config: Pick<YouTubeMusicConfig, "gl" | "hl">) {
  const region = normalizeRegionContext(config);
  return {
    client: {
      clientName: "IOS_MUSIC",
      clientVersion: IOS_MUSIC_VERSION,
      hl: region.hl,
      gl: region.gl,
      platform: "MOBILE",
      osName: "iOS",
      osVersion: IOS_OS_VERSION,
      deviceMake: "Apple",
      deviceModel: IOS_DEVICE_MODEL,
    },
    user: { lockedSafetyMode: false },
  };
}

export function buildInnerTubeBody(
  config: Pick<YouTubeMusicConfig, "gl" | "hl">,
  body: Record<string, any> = {},
): Record<string, any> {
  return {
    context: buildIOSContext(config),
    ...body,
  };
}

export async function ytFetch(
  endpoint: string,
  config: YouTubeMusicConfig,
  body: Record<string, any> = {},
): Promise<any> {
  const accessToken = await mintAccessToken(config.refreshToken);
  const fullBody = buildInnerTubeBody(config, body);

  const cacheKey = makeResponseCacheKey(config.refreshToken, endpoint, fullBody);
  const cached = getCachedResponse(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const res = await fetch(`${INNERTUBE_BASE}/${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": MOBILE_UA,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(fullBody),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`InnerTube ${endpoint} failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const parsed = await res.json();
  setCachedResponse(cacheKey, parsed);
  return parsed;
}
