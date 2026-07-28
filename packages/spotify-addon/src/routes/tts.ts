import { AddonError } from "@resonance-addons/sdk";
import { getAccessToken, spotifyFetch } from "../auth";

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return bytes;
}

function encodeTag(fieldNumber: number, wireType: number): number[] {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeString(fieldNumber: number, value: string): number[] {
  const encoded = new TextEncoder().encode(value);
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(encoded.length), ...Array.from(encoded)];
}

function encodeVarintField(fieldNumber: number, value: number): number[] {
  return [...encodeTag(fieldNumber, 0), ...encodeVarint(value)];
}

function readVarint(data: Uint8Array, offset: number): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  while (offset < data.length && shift < 35) {
    const byte = data[offset++]!;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
  }
  throw new AddonError("Invalid Spotify narration manifest", 502);
}

function lengthDelimitedField(data: Uint8Array, fieldNumber: number): Uint8Array | null {
  let offset = 0;
  while (offset < data.length) {
    const tag = readVarint(data, offset);
    offset = tag.offset;
    const field = tag.value >>> 3;
    const wireType = tag.value & 0x7;
    if (wireType === 0) {
      offset = readVarint(data, offset).offset;
      continue;
    }
    if (wireType === 1) {
      offset += 8;
      continue;
    }
    if (wireType === 5) {
      offset += 4;
      continue;
    }
    if (wireType !== 2) {
      throw new AddonError("Unsupported Spotify narration manifest", 502);
    }
    const length = readVarint(data, offset);
    offset = length.offset;
    const end = offset + length.value;
    if (end > data.length) {
      throw new AddonError("Truncated Spotify narration manifest", 502);
    }
    const value = data.slice(offset, end);
    if (field === fieldNumber) return value;
    offset = end;
  }
  return null;
}

function decodedString(value: Uint8Array | null): string | null {
  return value ? new TextDecoder().decode(value) : null;
}

export function decodeTTSManifest(manifestBase64: string): Uint8Array {
  const files = new Uint8Array(Buffer.from(manifestBase64, "base64"));
  const file = lengthDelimitedField(files, 1);
  const externalFile = file ? lengthDelimitedField(file, 1) : null;
  if (!externalFile) {
    throw new AddonError("Spotify narration has no external audio request", 502);
  }
  const method = decodedString(lengthDelimitedField(externalFile, 1));
  const service = decodedString(lengthDelimitedField(externalFile, 3));
  const body = lengthDelimitedField(externalFile, 4);
  if (method !== "POST" || service !== "client-tts/v1/fulfill" || !body?.length) {
    throw new AddonError("Unsupported Spotify narration request", 502);
  }
  return body;
}

async function fulfillTTSRequest(spDc: string, body: Uint8Array): Promise<{ data: string; contentType: string }> {
  const token = await getAccessToken(spDc);
  const res = await spotifyFetch(
    "https://spclient.wg.spotify.com/client-tts/v1/fulfill",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
    { cacheable: false },
  );

  let audioRes = res;
  if (res.status === 303) {
    const location = res.headers.get("Location");
    if (!location) {
      throw new AddonError("Missing redirect location", 502);
    }
    audioRes = await spotifyFetch(location, {}, { cacheable: false });
  }
  if (!audioRes.ok) {
    throw new AddonError("TTS request failed", audioRes.status);
  }
  const audioData = await audioRes.arrayBuffer();
  return {
    data: Buffer.from(audioData).toString("base64"),
    contentType: audioRes.headers.get("Content-Type") ?? "audio/mpeg",
  };
}

export function fulfillTTSManifest(
  spDc: string,
  manifestBase64: string,
): Promise<{ data: string; contentType: string }> {
  return fulfillTTSRequest(spDc, decodeTTSManifest(manifestBase64));
}

export function fulfillTTSRequestHex(spDc: string, requestHex: string): Promise<{ data: string; contentType: string }> {
  return fulfillTTSRequest(spDc, new Uint8Array(Buffer.from(requestHex, "hex")));
}

export async function handleTTS(
  spDc: string,
  text: string,
  voiceId?: string,
): Promise<{ data: string; contentType: "audio/mpeg" }> {
  const ssml = `<speak xml:lang="en-US">${text}</speak>`;

  const proto = new Uint8Array([
    ...encodeString(2, ssml),
    ...encodeVarintField(3, 5),
    ...encodeString(4, "en-US"),
    ...encodeVarintField(5, voiceId ? parseInt(voiceId, 10) : 1),
    ...encodeVarintField(6, 6),
    ...encodeVarintField(7, 44100),
  ]);

  const audio = await fulfillTTSRequest(spDc, proto);
  return {
    data: audio.data,
    contentType: "audio/mpeg",
  };
}
