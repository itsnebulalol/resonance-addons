import { AsyncLocalStorage } from "node:async_hooks";
import { errorResponse, json } from "./response";

const FETCH_REPLAY_HEADER = "X-Resonance-On-Device-Fetch-ID";
const FETCH_REPLAY_TTL_MS = 2 * 60_000;
const MAX_REPLAY_BODY_BASE64_CHARS = 16 * 1024 * 1024;
const FETCH_ERROR_MARKER = "__resonance_on_device_fetch__:";

interface OnDeviceFetchContext {
  replayID?: string;
  replayConsumed: boolean;
}

interface OnDeviceFetchReplayEntry {
  response: CapturedOnDeviceResponse;
  expiresAt: number;
}

const contextStore = new AsyncLocalStorage<OnDeviceFetchContext>();
const replayStore = new Map<string, OnDeviceFetchReplayEntry>();

export interface OnDeviceFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | ArrayBuffer | null;
  timeoutMs?: number;
}

interface OnDeviceFetchSpec {
  id: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
  timeoutMs?: number;
}

interface CapturedOnDeviceResponse {
  status: number;
  headers: Record<string, string>;
  bodyBase64: string;
}

interface OnDeviceFetchReplayUpload {
  id: string;
  response: CapturedOnDeviceResponse;
}

export class OnDeviceFetchRequiredError extends Error {
  readonly spec: OnDeviceFetchSpec;

  constructor(spec: OnDeviceFetchSpec) {
    super(`${FETCH_ERROR_MARKER}${encodeSpec(spec)}`);
    this.name = "OnDeviceFetchRequiredError";
    this.spec = spec;
  }
}

export function runWithOnDeviceFetchContext<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const replayID = req.headers.get(FETCH_REPLAY_HEADER) ?? undefined;
  return contextStore.run({ replayID, replayConsumed: false }, fn);
}

export function isOnDeviceFetchRequiredError(error: unknown): error is OnDeviceFetchRequiredError {
  return error instanceof OnDeviceFetchRequiredError;
}

export function responseForOnDeviceFetchRequired(error: OnDeviceFetchRequiredError): Response {
  return json({ error: "on_device_fetch_required", onDeviceFetch: error.spec }, 428);
}

export function responseForOnDeviceFetchMarker(message: string | undefined): Response | null {
  if (!message) {
    return null;
  }
  const markerIndex = message.indexOf(FETCH_ERROR_MARKER);
  if (markerIndex === -1) {
    return null;
  }
  const encoded = message.slice(markerIndex + FETCH_ERROR_MARKER.length).trim();
  const spec = decodeSpec(encoded);
  if (!spec) {
    return null;
  }
  return json({ error: "on_device_fetch_required", onDeviceFetch: spec }, 428);
}

export async function recoverOnDeviceFetchResponse(response: Response): Promise<Response> {
  if (response.status < 500) {
    return response;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return response;
  }

  try {
    const payload = (await response.clone().json()) as Record<string, unknown>;
    const message = typeof payload.error === "string" ? payload.error : undefined;
    const recovered = responseForOnDeviceFetchMarker(message);
    return recovered ?? response;
  } catch {
    return response;
  }
}

export async function onDeviceFetch(url: string, init: OnDeviceFetchInit = {}): Promise<Response> {
  const context = contextStore.getStore();
  if (context?.replayID && !context.replayConsumed) {
    context.replayConsumed = true;
    const replay = consumeReplay(context.replayID);
    if (replay) {
      return replayToResponse(replay);
    }
  }

  const method = (init.method ?? "GET").toUpperCase();
  const spec: OnDeviceFetchSpec = {
    id: crypto.randomUUID(),
    method,
    url,
  };

  if (init.headers && Object.keys(init.headers).length > 0) {
    spec.headers = init.headers;
  }

  const bodyBase64 = encodeBody(init.body);
  if (bodyBase64) {
    spec.bodyBase64 = bodyBase64;
  }

  if (typeof init.timeoutMs === "number" && Number.isFinite(init.timeoutMs) && init.timeoutMs > 0) {
    spec.timeoutMs = Math.round(init.timeoutMs);
  }

  throw new OnDeviceFetchRequiredError(spec);
}

export async function handleOnDeviceFetchReplayUpload(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return errorResponse("Invalid JSON payload", 400);
  }

  const parsed = normalizeReplayUpload(payload);
  if (!parsed.ok) {
    return errorResponse(parsed.error, 400);
  }

  pruneReplayStore();
  replayStore.set(parsed.value.id, {
    response: parsed.value.response,
    expiresAt: Date.now() + FETCH_REPLAY_TTL_MS,
  });

  return json({ ok: true });
}

function encodeBody(body: OnDeviceFetchInit["body"]): string | undefined {
  if (body == null) {
    return undefined;
  }
  if (typeof body === "string") {
    return Buffer.from(body, "utf8").toString("base64");
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString("base64");
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body).toString("base64");
  }
  return undefined;
}

function replayToResponse(replay: CapturedOnDeviceResponse): Response {
  const body = replay.bodyBase64 ? Buffer.from(replay.bodyBase64, "base64") : undefined;
  return new Response(body, {
    status: replay.status,
    headers: replay.headers,
  });
}

function consumeReplay(id: string): CapturedOnDeviceResponse | null {
  pruneReplayStore();
  const entry = replayStore.get(id);
  if (!entry) {
    return null;
  }
  replayStore.delete(id);
  return entry.response;
}

function pruneReplayStore(): void {
  const now = Date.now();
  for (const [id, entry] of replayStore.entries()) {
    if (entry.expiresAt <= now) {
      replayStore.delete(id);
    }
  }
}

function normalizeReplayUpload(
  payload: unknown,
): { ok: true; value: OnDeviceFetchReplayUpload } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Replay payload must be an object" };
  }

  const id = (payload as Record<string, unknown>).id;
  const response = (payload as Record<string, unknown>).response;

  if (typeof id !== "string" || id.length < 8) {
    return { ok: false, error: "Invalid replay id" };
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return { ok: false, error: "Missing replay response" };
  }

  const statusRaw = (response as Record<string, unknown>).status;
  const status = typeof statusRaw === "number" ? Math.round(statusRaw) : Number.NaN;
  if (!Number.isFinite(status) || status < 100 || status > 599) {
    return { ok: false, error: "Invalid replay status" };
  }

  const bodyBase64 = (response as Record<string, unknown>).bodyBase64;
  if (typeof bodyBase64 !== "string") {
    return { ok: false, error: "Missing replay body" };
  }
  if (bodyBase64.length > MAX_REPLAY_BODY_BASE64_CHARS) {
    return { ok: false, error: "Replay body is too large" };
  }

  const headersRaw = (response as Record<string, unknown>).headers;
  const headers: Record<string, string> = {};
  if (headersRaw != null) {
    if (!headersRaw || typeof headersRaw !== "object" || Array.isArray(headersRaw)) {
      return { ok: false, error: "Invalid replay headers" };
    }
    for (const [key, value] of Object.entries(headersRaw)) {
      if (!key) {
        continue;
      }
      headers[key] = typeof value === "string" ? value : String(value);
    }
  }

  return {
    ok: true,
    value: {
      id,
      response: {
        status,
        headers,
        bodyBase64,
      },
    },
  };
}

function encodeSpec(spec: OnDeviceFetchSpec): string {
  return Buffer.from(JSON.stringify(spec), "utf8").toString("base64url");
}

function decodeSpec(encoded: string): OnDeviceFetchSpec | null {
  if (!encoded) {
    return null;
  }
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Partial<OnDeviceFetchSpec>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.id !== "string" || !parsed.id) {
      return null;
    }
    if (typeof parsed.method !== "string" || !parsed.method) {
      return null;
    }
    if (typeof parsed.url !== "string" || !parsed.url) {
      return null;
    }

    const spec: OnDeviceFetchSpec = {
      id: parsed.id,
      method: parsed.method,
      url: parsed.url,
    };
    if (parsed.headers && typeof parsed.headers === "object" && !Array.isArray(parsed.headers)) {
      spec.headers = Object.fromEntries(
        Object.entries(parsed.headers).map(([key, value]) => [key, typeof value === "string" ? value : String(value)]),
      );
    }
    if (typeof parsed.bodyBase64 === "string") {
      spec.bodyBase64 = parsed.bodyBase64;
    }
    if (typeof parsed.timeoutMs === "number" && Number.isFinite(parsed.timeoutMs) && parsed.timeoutMs > 0) {
      spec.timeoutMs = Math.round(parsed.timeoutMs);
    }

    return spec;
  } catch {
    return null;
  }
}
