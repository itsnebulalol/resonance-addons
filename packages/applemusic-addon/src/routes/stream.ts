import type { StreamCodec, StreamDescriptor, StreamPartialPersistence, StreamPreparation } from "@resonance-addons/sdk";

export type AppleMusicStreamDescriptor = StreamDescriptor;

interface BackendStreamResponse {
  state?: string;
  url?: string;
  bitrate?: number | null;
  durationSeconds?: number | null;
  format?: string | null;
  contentLength?: number | null;
  cacheIdentity?: string;
  partialPersistence?: string;
  quality?: {
    codec?: string | null;
    sampleRate?: number | null;
    bitDepth?: number | null;
    channels?: number | null;
  } | null;
  preparation?: {
    id?: string;
    state?: string;
    statusUrl?: string;
  } | null;
}

function serverEndpoint(serverUrl: string): URL {
  const value = serverUrl.trim();
  if (!value) throw new Error("Apple Music streaming server URL is not configured");
  const base = new URL(value.endsWith("/") ? value : `${value}/`);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("Apple Music streaming server URL must use HTTP or HTTPS");
  }
  return new URL("v1/resolve", base.href);
}

function resolvedMediaURL(serverUrl: string, returnedURL: string): string {
  const base = new URL(serverUrl.trim().endsWith("/") ? serverUrl.trim() : `${serverUrl.trim()}/`);
  return new URL(returnedURL.replace(/^\/+/, ""), base.href).href;
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function streamCodec(value: string | null | undefined): StreamCodec | null {
  if (value === "aac" || value === "alac") return value;
  return null;
}

function expiresAtUnixMilliseconds(url: string): number | null {
  const raw = new URL(url).searchParams.get("expires");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.trunc(seconds * 1000) : null;
}

function partialPersistence(value: string | null | undefined): StreamPartialPersistence {
  if (value === "validatedRanges" || value === "immutablePrefix") return value;
  throw new Error("Apple Music streaming server returned invalid partial persistence");
}

function preparation(result: BackendStreamResponse, serverUrl: string, serverToken: string): StreamPreparation | null {
  if (!result.preparation) return null;
  const id = result.preparation.id?.trim();
  const statusUrl = result.preparation.statusUrl?.trim();
  if (!id || !statusUrl) {
    throw new Error("Apple Music streaming server returned incomplete preparation controls");
  }
  const url = resolvedMediaURL(serverUrl, statusUrl);
  const requestHeaders = {
    Authorization: `Bearer ${serverToken.trim()}`,
  };
  return {
    id,
    statusRequest: {
      url,
      method: "get",
      requestHeaders,
    },
    cancelRequest: {
      url,
      method: "delete",
      requestHeaders,
    },
    refreshRequest: null,
  };
}

// trackId = Apple Music catalog song adamId
export async function handleStream(
  trackId: string,
  serverUrl: string,
  serverToken: string,
): Promise<AppleMusicStreamDescriptor> {
  console.log(`[stream] resolveStream trackId=${trackId}`);
  if (!serverToken?.trim()) throw new Error("Apple Music streaming server token is not configured");

  const response = await fetch(serverEndpoint(serverUrl).href, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serverToken.trim()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ trackId }),
  });
  if (!response.ok) {
    throw new Error(`Apple Music streaming server HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const result = (await response.json()) as BackendStreamResponse;
  if (!result.url) throw new Error("Apple Music streaming server returned no media URL");
  const format = (result.format ?? "audio/mp4").toLowerCase();
  if (!format.startsWith("audio/mp4")) {
    throw new Error(`Apple Music streaming server returned unsupported media format: ${format}`);
  }

  const url = resolvedMediaURL(serverUrl, result.url);
  const codec = streamCodec(result.quality?.codec);
  if (!codec) {
    throw new Error("Apple Music streaming server returned an unknown codec");
  }
  const sampleRate = positiveNumber(result.quality?.sampleRate);
  const bitDepth = positiveNumber(result.quality?.bitDepth);
  const cacheIdentity = result.cacheIdentity?.trim();
  if (!cacheIdentity) {
    throw new Error("Apple Music streaming server returned no cache identity");
  }
  const persistence = partialPersistence(result.partialPersistence);
  const contentLength = positiveNumber(result.contentLength);
  const streamPreparation = preparation(result, serverUrl, serverToken);
  if (streamPreparation?.id === cacheIdentity) {
    throw new Error("Apple Music preparation identity must differ from cache identity");
  }
  if (persistence === "immutablePrefix" && !streamPreparation) {
    throw new Error("Apple Music growing stream returned no preparation controls");
  }
  if (persistence === "validatedRanges" && contentLength === null) {
    throw new Error("Apple Music finalized stream returned no content length");
  }
  return {
    schemaVersion: 1,
    state: "ready",
    url,
    transport: "progressive",
    container: "fragmentedMp4",
    codec,
    requestHeaders: {},
    bitrate: positiveNumber(result.bitrate),
    durationSeconds: positiveNumber(result.durationSeconds),
    contentLength,
    sampleRate,
    bitDepth,
    channelCount: positiveNumber(result.quality?.channels),
    rangeSupport: "bytes",
    seekMode: "byteRange",
    expiresAtUnixMilliseconds: expiresAtUnixMilliseconds(url),
    cacheIdentity,
    cachePolicy: "cacheable",
    partialPersistence: persistence,
    preparation: streamPreparation,
  };
}
