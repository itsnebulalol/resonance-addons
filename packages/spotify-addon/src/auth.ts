const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const SPOTIFY_APP_VERSION = "1.2.80.313.gd1726b65";
const WEB_PLAYER_CLIENT_ID = "d8a5ed958d274c2e8ee717e6a4b0971d";
const RESPONSE_CACHE_TTL_MS = 15_000;
const RESPONSE_CACHE_MAX_ENTRIES = 48;
const MAX_CACHE_BODY_BYTES = 2 * 1024 * 1024;

const tokenCache = new Map<string, { token: string; expires: number }>();
const pendingTokens = new Map<string, Promise<string>>();
const responseCache = new Map<string, CachedDelegatedResponse>();

let cachedSecret: { secret: Buffer; version: number; expiresAt: number } | null = null;
let pendingSecret: Promise<{ secret: Buffer; version: number }> | null = null;

interface SpotifyFetchOptions {
  cacheable?: boolean;
  cacheKey?: string;
}

interface SpotifyFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | ArrayBuffer | null;
}

interface CachedDelegatedResponse {
  status: number;
  headers: Record<string, string>;
  bodyBase64: string;
  expiresAt: number;
}

const cryptoBridge: any = (globalThis as any).crypto;

function bodyToBuffer(body: SpotifyFetchInit["body"]): Buffer | null {
  if (body == null) {
    return null;
  }
  if (typeof body === "string") {
    return Buffer.from(body, "utf8");
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }
  return null;
}

function normalizedHeaders(headers: Record<string, string> | undefined): [string, string][] {
  if (!headers) {
    return [];
  }
  return Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value] as [string, string])
    .sort(([a], [b]) => a.localeCompare(b));
}

function resolveCacheKey(url: string, init: SpotifyFetchInit, options: SpotifyFetchOptions): string | null {
  if (options.cacheable === false) {
    return null;
  }

  const method = (init.method ?? "GET").toUpperCase();
  const shouldCache = Boolean(options.cacheKey) || options.cacheable === true || method === "GET";
  if (!shouldCache) {
    return null;
  }

  if (options.cacheKey) {
    return `manual:${options.cacheKey}`;
  }

  const signature = JSON.stringify({
    method,
    url,
    headers: normalizedHeaders(init.headers),
    body: bodyToBuffer(init.body)?.toString("base64") ?? null,
  });
  return `auto:${cryptoBridge.createHash("sha256").update(signature).digest("hex")}`;
}

function pruneResponseCache(now = Date.now()): void {
  for (const [key, value] of responseCache.entries()) {
    if (value.expiresAt <= now) {
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

function getCachedResponse(key: string): CachedDelegatedResponse | null {
  const cached = responseCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return cached;
}

function setCachedResponse(key: string, response: Omit<CachedDelegatedResponse, "expiresAt">): void {
  pruneResponseCache();
  responseCache.delete(key);
  responseCache.set(key, {
    ...response,
    expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
  });
  pruneResponseCache();
}

function materializeResponse(response: Pick<CachedDelegatedResponse, "status" | "headers" | "bodyBase64">): Response {
  const body = response.bodyBase64 ? Buffer.from(response.bodyBase64, "base64") : undefined;
  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function spotifyFetch(
  url: string,
  init: SpotifyFetchInit = {},
  options: SpotifyFetchOptions = {},
): Promise<Response> {
  const cacheKey = resolveCacheKey(url, init, options);

  if (cacheKey) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      return materializeResponse(cached);
    }
  }

  const response = await fetch(url, init as RequestInit);
  if (!cacheKey) {
    return response;
  }

  const bodyBytes = Buffer.from(await response.arrayBuffer());
  const headers = Object.fromEntries(response.headers.entries());
  if (bodyBytes.length <= MAX_CACHE_BODY_BYTES) {
    setCachedResponse(cacheKey, {
      status: response.status,
      headers,
      bodyBase64: bodyBytes.toString("base64"),
    });
  }

  return new Response(bodyBytes, {
    status: response.status,
    headers,
  });
}

export async function scrapeSecret(): Promise<{ secret: Buffer; version: number }> {
  if (cachedSecret && Date.now() < cachedSecret.expiresAt) {
    return cachedSecret;
  }

  if (pendingSecret) return pendingSecret;

  const promise = (async () => {
    const html = await spotifyFetch("https://open.spotify.com/", {
      headers: { "User-Agent": USER_AGENT },
    }).then((r) => r.text());

    const jsMatch = html.match(/https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/web-player\.[a-f0-9]+\.js/);
    if (!jsMatch) throw new Error("Could not find web player JS bundle URL");

    const js = await spotifyFetch(jsMatch[0], {
      headers: { "User-Agent": USER_AGENT },
    }).then((r) => r.text());

    const entryMatch = js.match(/\{secret:(['"])((?:(?!\1).|\\.)*?)\1,version:(\d+)\}/);
    if (!entryMatch) throw new Error("Could not find TOTP secret in JS bundle");

    const rawSecret = entryMatch[2]!;
    const version = parseInt(entryMatch[3]!, 10);

    const transformed: number[] = rawSecret.split("").map((ch, i) => ch.charCodeAt(0) ^ ((i % 33) + 9));
    const hexStr = Buffer.from(transformed.join(""), "utf8").toString("hex");
    const secret = Buffer.from(hexStr, "hex");

    cachedSecret = { secret, version, expiresAt: Date.now() + 3600_000 };
    console.log(`[auth] Scraped TOTP secret (version ${version}, ${secret.length} bytes)`);
    return { secret, version };
  })();

  pendingSecret = promise;
  void promise
    .finally(() => {
      pendingSecret = null;
    })
    .catch(() => {});
  return promise;
}

function generateTOTP(secret: Buffer, timestampSec: number): string {
  const period = 30;
  const digits = 6;
  const counter = Math.floor(timestampSec / period);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = cryptoBridge.createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

let cachedClientToken: { token: string; expiresAt: number } | null = null;
let pendingClientToken: Promise<string> | null = null;

export async function getClientToken(): Promise<string> {
  if (cachedClientToken && Date.now() < cachedClientToken.expiresAt) {
    return cachedClientToken.token;
  }
  if (pendingClientToken) return pendingClientToken;

  const promise = (async () => {
    const deviceId = crypto.randomUUID().replace(/-/g, "").toLowerCase();
    const res = await fetch("https://clienttoken.spotify.com/v1/clienttoken", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_data: {
          client_version: SPOTIFY_APP_VERSION,
          client_id: WEB_PLAYER_CLIENT_ID,
          js_sdk_data: {
            device_brand: "Apple",
            device_model: "unknown",
            os: "macos",
            os_version: "10.15.7",
            device_id: deviceId,
            device_type: "computer",
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`Client token request failed: ${res.status}`);
    const json = (await res.json()) as any;
    const token = json?.granted_token?.token;
    const expiresIn = json?.granted_token?.expires_after_seconds ?? 3600;
    if (!token) throw new Error("No client token in response");
    cachedClientToken = { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
    console.log(`[auth] Client token acquired, expires in ${expiresIn}s`);
    return token as string;
  })();

  pendingClientToken = promise;
  void promise
    .finally(() => {
      pendingClientToken = null;
    })
    .catch(() => {});
  return promise;
}

export interface PathfinderOperation {
  name: string;
  hash: string;
  variables: Record<string, any>;
}

export async function pathfinderRequest(spDc: string, operation: PathfinderOperation): Promise<any> {
  const accessToken = await getAccessToken(spDc);
  const clientToken = await getClientToken();

  const res = await fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "application/json",
      "app-platform": "WebPlayer",
      "spotify-app-version": SPOTIFY_APP_VERSION,
      "User-Agent": USER_AGENT,
      Origin: "https://open.spotify.com",
      "client-token": clientToken,
    },
    body: JSON.stringify({
      operationName: operation.name,
      variables: operation.variables,
      extensions: { persistedQuery: { version: 1, sha256Hash: operation.hash } },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pathfinder ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

export async function getAccessToken(spDc: string): Promise<string> {
  const cached = tokenCache.get(spDc);
  if (cached && Date.now() < cached.expires) {
    return cached.token;
  }

  const pending = pendingTokens.get(spDc);
  if (pending) return pending;

  const promise = (async () => {
    const { secret, version } = await scrapeSecret();

    const serverTimeRes = await spotifyFetch("https://open.spotify.com/", {
      headers: {
        Cookie: `sp_dc=${spDc}`,
        "User-Agent": USER_AGENT,
      },
    });
    const pageHtml = await serverTimeRes.text();
    const configMatch = pageHtml.match(/<script id="appServerConfig" type="text\/plain">([^<]+)<\/script>/);
    let serverTime = Math.floor(Date.now() / 1000);
    if (configMatch) {
      try {
        const config = JSON.parse(Buffer.from(configMatch[1]!, "base64").toString("utf8"));
        if (config.serverTime) serverTime = config.serverTime;
      } catch {}
    }

    const totp = generateTOTP(secret, serverTime);
    const totpServer = generateTOTP(secret, serverTime);

    const params = new URLSearchParams({
      reason: "transport",
      productType: "web-player",
      totp,
      totpServer,
      totpVer: String(version),
    });

    const res = await spotifyFetch(`https://open.spotify.com/api/token?${params.toString()}`, {
      headers: {
        Cookie: `sp_dc=${spDc}`,
        "User-Agent": USER_AGENT,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      accessToken: string;
      accessTokenExpirationTimestampMs: number;
      isAnonymous?: boolean;
    };

    if (data.isAnonymous) {
      throw new Error("sp_dc cookie is invalid or expired — reconnect in addon settings");
    }

    tokenCache.set(spDc, {
      token: data.accessToken,
      expires: data.accessTokenExpirationTimestampMs - 60_000,
    });

    console.log("[auth] Token acquired, expires:", new Date(data.accessTokenExpirationTimestampMs).toISOString());
    return data.accessToken;
  })();

  pendingTokens.set(spDc, promise);
  void promise
    .finally(() => {
      pendingTokens.delete(spDc);
    })
    .catch(() => {});
  return promise;
}
