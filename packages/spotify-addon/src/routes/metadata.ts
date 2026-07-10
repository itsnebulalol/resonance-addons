import { getAccessToken, getClientToken, spotifyFetch } from "../auth";
import { PROVIDER_ID } from "../utils";
import { searchSpotifyTrack } from "./search";

const APP_VERSION = "1.2.80.313.gd1726b65";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const SPCLIENT = "https://spclient.wg.spotify.com";
const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface DecodedTrackMetadata {
  isrc: string | null;
}

const EMPTY_METADATA = {
  fullscreenArtworkURL: null,
  animatedArtworkURL: null,
  resolvedDurationSeconds: null,
  externalIDs: {},
};

function spotifyIdToGid(trackId: string): string | null {
  let value = 0n;
  for (const character of trackId) {
    const digit = BASE62.indexOf(character);
    if (digit < 0) return null;
    value = value * 62n + BigInt(digit);
  }
  const gid = value.toString(16);
  return gid.length <= 32 ? gid.padStart(32, "0") : null;
}

function readVarint(data: Buffer, start: number): { value: number; offset: number } {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < data.length) {
    const byte = data[offset++]!;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error("protobuf varint exceeds safe integer range");
      return { value: number, offset };
    }
    shift += 7n;
    if (shift > 63n) throw new Error("invalid protobuf varint");
  }
  throw new Error("truncated protobuf varint");
}

function readLengthDelimited(data: Buffer, start: number): { value: Buffer; offset: number } {
  const length = readVarint(data, start);
  const end = length.offset + length.value;
  if (end > data.length) throw new Error("truncated protobuf field");
  return { value: data.subarray(length.offset, end), offset: end };
}

function skipField(data: Buffer, start: number, wireType: number): number {
  switch (wireType) {
    case 0:
      return readVarint(data, start).offset;
    case 1:
      if (start + 8 > data.length) throw new Error("truncated protobuf fixed64");
      return start + 8;
    case 2:
      return readLengthDelimited(data, start).offset;
    case 5:
      if (start + 4 > data.length) throw new Error("truncated protobuf fixed32");
      return start + 4;
    default:
      throw new Error(`unsupported protobuf wire type ${wireType}`);
  }
}

function decodeExternalId(data: Buffer): { type: string | null; id: string | null } {
  let type: string | null = null;
  let id: string | null = null;
  let offset = 0;
  while (offset < data.length) {
    const tag = readVarint(data, offset);
    offset = tag.offset;
    const field = tag.value >>> 3;
    const wireType = tag.value & 7;
    if (wireType === 2 && (field === 1 || field === 2)) {
      const value = readLengthDelimited(data, offset);
      offset = value.offset;
      if (field === 1) type = value.value.toString("utf8");
      if (field === 2) id = value.value.toString("utf8");
    } else {
      offset = skipField(data, offset, wireType);
    }
  }
  return { type, id };
}

function decodeTrackMetadata(data: Buffer): DecodedTrackMetadata {
  let isrc: string | null = null;
  let offset = 0;
  while (offset < data.length) {
    const tag = readVarint(data, offset);
    offset = tag.offset;
    const field = tag.value >>> 3;
    const wireType = tag.value & 7;
    if (field === 10 && wireType === 2) {
      const externalId = readLengthDelimited(data, offset);
      offset = externalId.offset;
      const decoded = decodeExternalId(externalId.value);
      if (decoded.type?.toLowerCase() === "isrc" && decoded.id) {
        isrc = decoded.id;
      }
    } else {
      offset = skipField(data, offset, wireType);
    }
  }
  return { isrc };
}

async function fetchTrackMetadata(spDc: string, trackId: string): Promise<DecodedTrackMetadata | null> {
  const gid = spotifyIdToGid(trackId);
  if (!gid) return null;

  try {
    const [accessToken, clientToken] = await Promise.all([getAccessToken(spDc), getClientToken()]);
    const response = await spotifyFetch(
      `${SPCLIENT}/metadata/4/track/${gid}?market=from_token`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "client-token": clientToken,
          "app-platform": "WebPlayer",
          "spotify-app-version": APP_VERSION,
          "User-Agent": USER_AGENT,
          Origin: "https://open.spotify.com",
        },
      },
      { cacheable: true, cacheKey: `track-metadata:${gid}` },
    );
    if (!response.ok) return null;
    return decodeTrackMetadata(Buffer.from(await response.arrayBuffer()));
  } catch (error: any) {
    console.error("[spotify:metadata] Exact metadata lookup failed:", error?.message ?? String(error));
    return null;
  }
}

export async function handleMetadata(
  spDc: string,
  title?: string,
  artist?: string,
  trackId?: string,
  trackProvider?: string,
  thumbnailURL?: string,
): Promise<any> {
  const isLocalTrack = trackProvider === PROVIDER_ID && Boolean(trackId?.trim());
  const result = isLocalTrack
    ? { id: trackId!.trim(), image: thumbnailURL?.trim() || null }
    : title || artist
      ? await searchSpotifyTrack(spDc, title ?? "", artist ?? "")
      : null;
  if (!result) return EMPTY_METADATA;

  const decoded = await fetchTrackMetadata(spDc, result.id);
  const imageURL = result.image ? result.image.replace("ab67616d00001e02", "ab67616d0000b273") : null;
  const externalIDs: Record<string, string> = { spotifyId: result.id };
  if (decoded?.isrc) externalIDs.isrc = decoded.isrc;

  return {
    fullscreenArtworkURL: imageURL,
    animatedArtworkURL: null,
    resolvedDurationSeconds: null,
    externalIDs,
  };
}
