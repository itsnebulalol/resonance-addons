import { gzipSync } from "fflate";

const cryptoBridge: any = (globalThis as any).crypto;
const textEncoder = new TextEncoder();
const monotonicEpochMs = Date.now();
const SDK_VERSION = "0.9.4-rl-essopt-loginsend-onlinesend-bcdsend-heartbeat300.0s/30.0s-modern-payload125kB-batch100";

export interface GaboHistoryInput {
  credentialSeed: string;
  trackId: string;
  contextUri: string;
  playbackId: string;
  startedAtMs: number;
  listenedMs: number;
  completed: boolean;
  mediaFileId?: string | null;
}

interface GaboEventError {
  index?: number;
  transient?: boolean;
  reason?: number;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function varint(value: number | bigint): Uint8Array {
  let number = BigInt(value);
  const result: number[] = [];
  while (number >= 0x80n) {
    result.push(Number((number & 0x7fn) | 0x80n));
    number >>= 7n;
  }
  result.push(Number(number));
  return Uint8Array.from(result);
}

function fieldKey(field: number, wire: number): Uint8Array {
  return varint(field * 8 + wire);
}

function bytesField(field: number, value: Uint8Array): Uint8Array {
  return concat(fieldKey(field, 2), varint(value.length), value);
}

function stringField(field: number, value?: string | null): Uint8Array {
  return value ? bytesField(field, textEncoder.encode(value)) : new Uint8Array();
}

function intField(field: number, value?: number | bigint | null): Uint8Array {
  if (value === undefined || value === null || value === 0 || value === 0n) {
    return new Uint8Array();
  }
  return concat(fieldKey(field, 0), varint(value));
}

function boolField(field: number, value: boolean): Uint8Array {
  return value ? concat(fieldKey(field, 0), Uint8Array.of(1)) : new Uint8Array();
}

function fragment(name: string, data: Uint8Array): Uint8Array {
  return concat(stringField(1, name), bytesField(2, data));
}

function hashBytes(value: string, length: number): Uint8Array {
  const hex = cryptoBridge.createHash("sha256").update(value).digest("hex");
  return Buffer.from(hex, "hex").subarray(0, length);
}

function randomBytes(length: number): Uint8Array {
  return hashBytes(`${cryptoBridge.randomUUID()}:${Date.now()}:${Math.random()}`, length);
}

function hexBytes(value: string | null | undefined, expectedLength?: number): Uint8Array {
  const hex = (value ?? "").replace(/[^a-fA-F0-9]/g, "");
  if (hex.length === 0 || hex.length % 2 !== 0) {
    return new Uint8Array();
  }
  const bytes = Buffer.from(hex, "hex");
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    return new Uint8Array();
  }
  return bytes;
}

function playbackIDBytes(value: string): Uint8Array {
  const parsed = hexBytes(value, 16);
  return parsed.length === 16 ? parsed : randomBytes(16);
}

function contextKind(uri: string): string {
  const parts = uri.split(":");
  return parts.length >= 3 ? parts[1]! : "unknown";
}

function applicationDesktop(sessionID: Uint8Array): Uint8Array {
  return concat(stringField(1, "1.2.88.483"), intField(2, 128_800_483), bytesField(3, sessionID));
}

function deviceDesktop(seed: string): Uint8Array {
  const hash = Buffer.from(hashBytes(`device:${seed}`, 16));
  const sid = [0, 4, 8, 12].map((offset) => hash.readUInt32BE(offset)).join("-");
  return concat(
    stringField(1, "windows"),
    stringField(2, "Microsoft Corporation"),
    stringField(3, "Surface Laptop, 7th Edition"),
    stringField(4, `S-1-5-21-${sid}`),
    stringField(5, "10.0.26200"),
  );
}

function eventEnvelope(
  eventName: string,
  message: Uint8Array,
  input: GaboHistoryInput,
  sequenceID: Uint8Array,
  appSessionID: Uint8Array,
): Uint8Array {
  const fragments = [
    fragment("message", message),
    fragment("context_client_id", bytesField(1, hexBytes("65b708073fc0480ea92a077233ca87bd", 16))),
    fragment("context_installation_id", bytesField(1, hashBytes(`resonance:${input.credentialSeed}`, 16))),
    fragment("context_application_desktop", applicationDesktop(appSessionID)),
    fragment("context_device_desktop", deviceDesktop(input.credentialSeed)),
    fragment("context_time", intField(1, Date.now())),
    fragment(
      "context_monotonic_clock",
      concat(intField(1, 4), intField(2, Math.max(1, (Date.now() - monotonicEpochMs) * 1000))),
    ),
    fragment("context_sdk", concat(stringField(1, SDK_VERSION), stringField(2, "cpp"))),
    fragment("context_client_context_id", new Uint8Array()),
  ];

  return concat(
    stringField(2, eventName),
    ...fragments.map((value) => bytesField(3, value)),
    bytesField(4, sequenceID),
    intField(5, 1),
  );
}

function rawCoreStream(input: GaboHistoryInput, playbackID: Uint8Array): Uint8Array {
  const trackURI = `spotify:track:${input.trackId}`;
  const kind = contextKind(input.contextUri);
  const mediaID = hexBytes(input.mediaFileId);

  return concat(
    bytesField(1, playbackID),
    mediaID.length > 0 ? bytesField(4, mediaID) : new Uint8Array(),
    stringField(5, "audio"),
    stringField(9, kind),
    stringField(10, "clickrow"),
    stringField(11, kind),
    stringField(12, input.completed ? "trackdone" : "endplay"),
    intField(13, Math.max(1, Math.round(input.startedAtMs))),
    intField(14, Math.max(1, Math.round(input.listenedMs))),
    intField(15, Math.max(1, Math.round(input.listenedMs))),
    stringField(22, "Vorbis 320 kbps"),
    stringField(23, input.contextUri),
    stringField(24, trackURI),
    stringField(28, "context"),
    stringField(29, kind),
    intField(37, 6_003_700_000_000_000n),
    stringField(38, "full"),
    boolField(39, true),
    stringField(44, "local"),
    stringField(45, "boombox"),
    stringField(48, `ssp~${Buffer.from(randomBytes(16)).toString("hex")}`),
    stringField(63, Buffer.from(randomBytes(16)).toString("hex")),
    stringField(69, "boombox"),
    stringField(71, "context-player"),
  );
}

function contentIntegrity(playbackID: Uint8Array): Uint8Array {
  return bytesField(1, playbackID);
}

export function buildGaboHistoryRequest(input: GaboHistoryInput): Uint8Array {
  const playbackID = playbackIDBytes(input.playbackId);
  const sequenceID = randomBytes(20);
  const appSessionID = randomBytes(16);
  const request = concat(
    bytesField(1, eventEnvelope("RawCoreStream", rawCoreStream(input, playbackID), input, sequenceID, appSessionID)),
    bytesField(1, eventEnvelope("ContentIntegrity", contentIntegrity(playbackID), input, sequenceID, appSessionID)),
  );
  return gzipSync(request, { level: 1 });
}

function readVarint(bytes: Uint8Array, cursor: { offset: number }): bigint {
  let value = 0n;
  let shift = 0n;
  while (cursor.offset < bytes.length) {
    const byte = bytes[cursor.offset++]!;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7n;
  }
  throw new Error("Truncated Spotify history response");
}

function parseEventError(bytes: Uint8Array): GaboEventError {
  const cursor = { offset: 0 };
  const error: GaboEventError = {};
  while (cursor.offset < bytes.length) {
    const tag = Number(readVarint(bytes, cursor));
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire !== 0) throw new Error("Invalid Spotify history error response");
    const value = Number(readVarint(bytes, cursor));
    if (field === 1) error.index = value;
    if (field === 2) error.transient = Boolean(value);
    if (field === 3) error.reason = value;
  }
  return error;
}

export function parseGaboErrors(bytes: Uint8Array): GaboEventError[] {
  const cursor = { offset: 0 };
  const errors: GaboEventError[] = [];
  while (cursor.offset < bytes.length) {
    const tag = Number(readVarint(bytes, cursor));
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire !== 2) throw new Error("Invalid Spotify history response");
    const length = Number(readVarint(bytes, cursor));
    const end = cursor.offset + length;
    if (end > bytes.length) throw new Error("Truncated Spotify history response");
    if (field === 1) errors.push(parseEventError(bytes.subarray(cursor.offset, end)));
    cursor.offset = end;
  }
  return errors;
}
