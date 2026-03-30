const CLIENT_ID = "755973059757-iigsfdoqt2c4qm209soqp2dlrh33almr.apps.googleusercontent.com";
const TOKEN_URL = "https://oauthaccountmanager.googleapis.com/v1/issuetoken";
const INNERTUBE_BASE = "https://music.youtube.com/youtubei/v1";
const MOBILE_UA = "com.google.ios.youtubemusic/6.49 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";

interface RegionContext {
  gl: string;
  hl: string;
}

let currentRegionContext: RegionContext = { gl: "US", hl: "en" };

export function runWithRegion<T>(gl: string, hl: string, fn: () => T): T {
  const previous = currentRegionContext;
  currentRegionContext = { gl, hl };
  try {
    return fn();
  } finally {
    currentRegionContext = previous;
  }
}

export function setRegionContext(gl: string, hl: string): void {
  currentRegionContext = { gl, hl };
}

export function getRegionContext(): RegionContext {
  return currentRegionContext;
}

const tokenCache = new Map<string, { token: string; expires: number }>();
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

function getIOSContext() {
  const region = getRegionContext();
  return {
    client: {
      clientName: "IOS_MUSIC",
      clientVersion: "6.49",
      hl: region.hl,
      gl: region.gl,
      platform: "MOBILE",
      osName: "iOS",
      osVersion: "18.3.2",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
    },
    user: { lockedSafetyMode: false },
  };
}

export async function ytFetch(endpoint: string, refreshToken: string, body: Record<string, any> = {}): Promise<any> {
  const accessToken = await mintAccessToken(refreshToken);

  const fullBody = {
    context: getIOSContext(),
    ...body,
  };

  const cacheKey = makeResponseCacheKey(refreshToken, endpoint, fullBody);
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
