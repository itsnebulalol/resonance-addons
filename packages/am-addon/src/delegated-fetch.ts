import { createHash } from "node:crypto";
import type { OnDeviceFetchInit } from "@resonance-addons/sdk";
import { onDeviceFetch } from "@resonance-addons/sdk";

const ON_DEVICE_FETCH_MARKER = "__resonance_on_device_fetch__:";
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

function bodyToBuffer(body: OnDeviceFetchInit["body"]): Buffer | null {
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

function resolveCacheKey(url: string, init: OnDeviceFetchInit, options: DelegatedFetchOptions): string | null {
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
  return `auto:${createHash("sha256").update(signature).digest("hex")}`;
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
  init: OnDeviceFetchInit = {},
  options: DelegatedFetchOptions = {},
): Promise<Response> {
  const cacheKey = resolveCacheKey(url, init, options);
  if (cacheKey) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      return materializeResponse(cached);
    }
  }

  const response = await onDeviceFetch(url, init);
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
