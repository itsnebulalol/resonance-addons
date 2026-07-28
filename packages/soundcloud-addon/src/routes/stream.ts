import { AddonError, type StreamCodec, type StreamContainer, type StreamDescriptor } from "@resonance-addons/sdk";
import {
  fetchTrack,
  hasPlayableTranscoding,
  PROVIDER_ID,
  type SoundCloudConfig,
  type SoundCloudTrack,
  type SoundCloudTranscoding,
  scFetch,
} from "../api";

function scoreTranscoding(transcoding: SoundCloudTranscoding): number {
  if (!transcoding.url || transcoding.snipped) return -1;
  const protocol = (transcoding.format?.protocol ?? "").toLowerCase();
  const mime = (transcoding.format?.mime_type ?? "").toLowerCase();
  const preset = transcoding.preset ?? "";
  if (protocol !== "progressive") return -1;

  let score = 80;
  if (mime.includes("audio/mpeg")) score += 25;
  if (mime.includes("mp4a") || mime.includes("audio/mp4")) score += 15;
  if (preset.includes("aac_160k")) score += 20;
  if (preset.includes("aac_96k")) score += 10;
  if (preset.includes("mp3")) score += 5;
  if (transcoding.quality === "sq") score += 5;
  return score;
}

function chooseTranscoding(track: SoundCloudTrack): SoundCloudTranscoding | null {
  const candidates = [...(track.media?.transcodings ?? [])]
    .filter((transcoding) => scoreTranscoding(transcoding) >= 0)
    .sort((a, b) => scoreTranscoding(b) - scoreTranscoding(a));
  return candidates[0] ?? null;
}

function bitrateFor(transcoding: SoundCloudTranscoding): number | null {
  const preset = transcoding.preset ?? "";
  if (preset.includes("160")) return 160000;
  if (preset.includes("128")) return 128000;
  if (preset.includes("96")) return 96000;
  return null;
}

function mediaDescription(mimeType: string | null | undefined): {
  container: StreamContainer;
  codec: StreamCodec;
} {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.includes("audio/mpeg")) return { container: "mp3", codec: "mp3" };
  if (mime.includes("audio/mp4") || mime.includes("mp4a")) return { container: "m4a", codec: "aac" };
  return { container: "unknown", codec: "unknown" };
}

function expiresAtUnixMilliseconds(url: string): number | null {
  try {
    const params = new URL(url).searchParams;
    const raw = params.get("Expires") ?? params.get("expires") ?? params.get("expire");
    if (!raw) return null;
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? Math.trunc(seconds * 1000) : null;
  } catch {
    return null;
  }
}

function hasPlayableHLS(track: SoundCloudTrack): boolean {
  return (track.media?.transcodings ?? []).some((transcoding) => {
    const protocol = (transcoding.format?.protocol ?? "").toLowerCase();
    return Boolean(transcoding.url && !transcoding.snipped && protocol === "hls");
  });
}

export async function handleStream(config: SoundCloudConfig, trackId: string): Promise<StreamDescriptor> {
  try {
    const track = await fetchTrack(config, trackId);
    if (!hasPlayableTranscoding(track)) {
      throw new AddonError("SoundCloud track is not available for off-platform streaming", 403);
    }

    const transcoding = chooseTranscoding(track);
    if (!transcoding?.url) {
      if (hasPlayableHLS(track)) {
        throw new AddonError("SoundCloud track is only available as HLS; progressive audio is required", 404);
      }
      throw new AddonError("SoundCloud track has no supported transcoding", 404);
    }

    const resolved = await scFetch<{ url?: string }>(config, transcoding.url, {
      track_authorization: (track as any).track_authorization,
    });
    if (!resolved.url) {
      throw new AddonError("SoundCloud stream resolver returned no URL", 502);
    }

    const durationMs = track.full_duration ?? track.duration ?? transcoding.duration ?? null;
    const media = mediaDescription(transcoding.format?.mime_type);
    const resolvedTrackId = String(track.id ?? trackId);
    return {
      schemaVersion: 1,
      state: "ready",
      url: resolved.url,
      transport: "progressive",
      container: media.container,
      codec: media.codec,
      requestHeaders: {},
      bitrate: bitrateFor(transcoding),
      durationSeconds: durationMs && durationMs > 0 ? durationMs / 1000 : null,
      contentLength: null,
      sampleRate: null,
      bitDepth: null,
      channelCount: null,
      rangeSupport: "unknown",
      seekMode: "restartFromZero",
      expiresAtUnixMilliseconds: expiresAtUnixMilliseconds(resolved.url),
      cacheIdentity: `${PROVIDER_ID}:stream:${resolvedTrackId}:${transcoding.preset ?? media.container}`,
      cachePolicy: "cacheable",
      partialPersistence: "validatedRanges",
      preparation: null,
    };
  } catch (error: any) {
    console.error("[soundcloud:stream] Error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}
