import type {
  ReadyStream,
  StreamCodec,
  StreamContainer,
  StreamControlRequest,
  StreamDescriptor,
  StreamPartialPersistence,
  StreamPreparation,
  StreamRangeSupport,
  StreamSeekMode,
  StreamTransport,
} from "@resonance-addons/sdk";
import { getAccessToken } from "../auth";

export type SpotifyStreamDescriptor = StreamDescriptor;

export interface BackendStreamResponse {
  state: "ready" | "preparing";
  url: string;
  bitrate: number | null;
  durationSeconds: number | null;
  format: string;
  contentLength: number | null;
  bitDepth: number | null;
  transport: Exclude<StreamTransport, "localFile">;
  rangeSupport: StreamRangeSupport;
  seekMode: StreamSeekMode;
  cacheIdentity: string;
  partialPersistence: StreamPartialPersistence;
  preparation: {
    id: string;
    statusRequest: StreamControlRequest;
    cancelRequest: StreamControlRequest;
    refreshRequest: StreamControlRequest | null;
  };
  pollAfterMilliseconds: number | null;
}

interface BackendStatusResponse {
  lifecycle?: {
    ready?: boolean;
    state?: string;
    error?: string | null;
  };
}

function serverEndpoint(serverUrl: string): URL {
  const value = serverUrl.trim();
  if (!value) throw new Error("Spotify streaming server URL is not configured");
  const base = new URL(value.endsWith("/") ? value : `${value}/`);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("Spotify streaming server URL must use HTTP or HTTPS");
  }
  return new URL("v1/resolve", base.href);
}

function resolvedMediaURL(serverUrl: string, returnedURL: string): string {
  const base = new URL(serverUrl.trim().endsWith("/") ? serverUrl.trim() : `${serverUrl.trim()}/`);
  return new URL(returnedURL.replace(/^\/+/, ""), base.href).href;
}

function resolvedControlRequest(
  serverUrl: string,
  request: StreamControlRequest | null | undefined,
  label: string,
): StreamControlRequest {
  if (!request?.url?.trim()) throw new Error(`Spotify streaming server returned no ${label} request`);
  return {
    ...request,
    url: resolvedMediaURL(serverUrl, request.url),
  };
}

function resolvedPreparation(
  serverUrl: string,
  preparation: BackendStreamResponse["preparation"] | null | undefined,
): StreamPreparation {
  if (!preparation) throw new Error("Spotify streaming server returned no preparation identity");
  const id = preparation.id?.trim();
  if (!id) throw new Error("Spotify streaming server returned no preparation identity");
  return {
    id,
    statusRequest: resolvedControlRequest(serverUrl, preparation.statusRequest, "preparation status"),
    cancelRequest: resolvedControlRequest(serverUrl, preparation.cancelRequest, "preparation cancellation"),
    refreshRequest: preparation.refreshRequest
      ? resolvedControlRequest(serverUrl, preparation.refreshRequest, "preparation refresh")
      : null,
  };
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function mediaDescription(format: string | null | undefined): {
  container: StreamContainer;
  codec: StreamCodec;
  profile: string;
} {
  const mimeType = (format ?? "").split(";", 1)[0]?.trim().toLowerCase();
  switch (mimeType) {
    case "audio/flac":
    case "audio/x-flac":
      return { container: "flac", codec: "flac", profile: "flac" };
    case "audio/mpeg":
      return { container: "mp3", codec: "mp3", profile: "mp3" };
    case "audio/aac":
      return { container: "adts", codec: "aac", profile: "adts-aac" };
    case "audio/mp4":
      return { container: "m4a", codec: "aac", profile: "m4a-aac" };
    default:
      throw new Error(`Spotify streaming server returned unsupported media format: ${format ?? "missing"}`);
  }
}

function expiresAtUnixMilliseconds(url: string): number | null {
  const raw = new URL(url).searchParams.get("expires");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.trunc(seconds * 1000) : null;
}

function exactCacheIdentity(value: string | null | undefined): string {
  const identity = value?.trim();
  if (!identity) throw new Error("Spotify streaming server returned no cache identity");
  return identity;
}

function partialPersistence(value: StreamPartialPersistence | null | undefined): StreamPartialPersistence {
  if (value === "immutablePrefix" || value === "validatedRanges") return value;
  throw new Error("Spotify streaming server returned invalid partial persistence");
}

async function waitForCompleteFile(
  preparation: StreamPreparation,
  pollAfterMilliseconds: number | null,
): Promise<void> {
  const statusRequest = preparation.statusRequest;
  if (!statusRequest) throw new Error("Spotify server returned no preparation status request");
  const delay = Math.min(5_000, Math.max(100, pollAfterMilliseconds ?? 250));
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await fetch(statusRequest.url, {
      method: statusRequest.method.toUpperCase(),
      headers: statusRequest.requestHeaders,
    });
    if (!response.ok) {
      throw new Error(`Spotify preparation status HTTP ${response.status}`);
    }
    const status = (await response.json()) as BackendStatusResponse;
    if (status.lifecycle?.ready) return;
    if (status.lifecycle?.state === "failed" || status.lifecycle?.state === "cancelled") {
      throw new Error(status.lifecycle.error ?? `Spotify preparation ${status.lifecycle.state}`);
    }
  }
  throw new Error("Spotify preparation timed out");
}

async function cancelPreparation(preparation: StreamPreparation): Promise<void> {
  const request = preparation.cancelRequest;
  if (!request) return;
  try {
    await fetch(request.url, {
      method: request.method.toUpperCase(),
      headers: request.requestHeaders,
    });
  } catch {
    // The server also expires abandoned leases; cancellation is best-effort on failure paths.
  }
}

export function mapBackendStreamResponse(result: BackendStreamResponse, serverUrl: string): ReadyStream {
  if (result.state !== "ready" && result.state !== "preparing") {
    throw new Error("Spotify streaming server returned invalid stream state");
  }
  const returnedURL = result.url?.trim();
  if (!returnedURL) throw new Error("Spotify streaming server returned no media URL");
  if (result.transport !== "progressive" && result.transport !== "completeFile") {
    throw new Error("Spotify streaming server returned invalid transport");
  }
  if (result.rangeSupport !== "bytes" || result.seekMode !== "byteRange") {
    throw new Error("Spotify streaming server returned invalid byte-range contract");
  }
  const url = resolvedMediaURL(serverUrl, returnedURL);
  const media = mediaDescription(result.format);
  const preparation = resolvedPreparation(serverUrl, result.preparation);
  return {
    schemaVersion: 1,
    state: "ready",
    url,
    transport: result.transport,
    container: media.container,
    codec: media.codec,
    requestHeaders: {},
    bitrate: positiveNumber(result.bitrate),
    durationSeconds: positiveNumber(result.durationSeconds),
    contentLength: positiveNumber(result.contentLength),
    sampleRate: null,
    bitDepth: positiveNumber(result.bitDepth),
    channelCount: null,
    rangeSupport: result.rangeSupport,
    seekMode: result.seekMode,
    expiresAtUnixMilliseconds: expiresAtUnixMilliseconds(url),
    cacheIdentity: exactCacheIdentity(result.cacheIdentity),
    cachePolicy: "cacheable",
    partialPersistence: partialPersistence(result.partialPersistence),
    preparation,
  };
}

export async function handleStream(
  spDc: string,
  trackId: string,
  serverUrl: string,
  serverToken: string,
): Promise<SpotifyStreamDescriptor> {
  console.log(`[stream] resolveStream trackId=${trackId}`);
  if (!serverToken?.trim()) throw new Error("Spotify streaming server token is not configured");

  try {
    const accessToken = await getAccessToken(spDc);
    const endpoint = serverEndpoint(serverUrl);
    console.log(`[stream] access token ready; contacting ${endpoint.host}`);
    const response = await fetch(endpoint.href, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverToken.trim()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ trackId, accessToken }),
    });
    if (!response.ok) {
      throw new Error(`Spotify streaming server HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const result = (await response.json()) as BackendStreamResponse;
    const stream = mapBackendStreamResponse(result, serverUrl);
    if (result.state === "preparing") {
      try {
        await waitForCompleteFile(stream.preparation!, result.pollAfterMilliseconds);
      } catch (error) {
        await cancelPreparation(stream.preparation!);
        throw error;
      }
    }
    return stream;
  } catch (error) {
    console.error(`[stream] failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
