const RESPONSE_CACHE_TTL_MS = 15_000;
const RESPONSE_CACHE_MAX_ENTRIES = 64;
const MAX_CACHE_BODY_BYTES = 2 * 1024 * 1024;

interface DelegatedFetchOptions {
  cacheable?: boolean;
  cacheKey?: string;
}

interface CachedDelegatedResponse {
  status: number;
  headers: Record<string, string>;
  bodyBase64: string;
  expiresAt: number;
}

const responseCache = new Map<string, CachedDelegatedResponse>();

type FetchHeaders = Record<string, string | readonly string[]> | string[][] | Headers;

function bodyToBuffer(body: RequestInit["body"]): Buffer | null {
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

function normalizedHeaders(headers: FetchHeaders | undefined): [string, string][] {
  if (!headers) {
    return [];
  }

  let entries: [string, string][];

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    entries = [...headers.entries()].map(([key, value]) => [key.toLowerCase(), value] as [string, string]);
  } else if (Array.isArray(headers)) {
    entries = headers
      .filter((entry) => entry.length >= 2)
      .map(([key, value]) => [String(key).toLowerCase(), String(value)] as [string, string]);
  } else {
    entries = Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      String(Array.isArray(value) ? value.join(",") : value),
    ]);
  }

  return entries.sort(([a], [b]) => a.localeCompare(b));
}

function resolveCacheKey(url: string, init: RequestInit, options: DelegatedFetchOptions): string | null {
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
  return `auto:${(globalThis.crypto as any).createHash("sha256").update(signature).digest("hex")}`;
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

export async function amFetch(
  url: string,
  init: RequestInit = {},
  options: DelegatedFetchOptions = {},
): Promise<Response> {
  const cacheKey = resolveCacheKey(url, init, options);
  if (cacheKey) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      return materializeResponse(cached);
    }
  }

  const response = await fetch(url, init);
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
