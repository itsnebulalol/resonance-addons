import { AddonError } from "@resonance-addons/sdk";
import {
  fetchTrack,
  hasPlayableTranscoding,
  type SoundCloudConfig,
  type SoundCloudTrack,
  type SoundCloudTranscoding,
  scFetch,
} from "../api";

interface SoundCloudStreamResult {
  url: string;
  bitrate: number | null;
  durationSeconds: number | null;
  format: string | null;
}

function scoreTranscoding(transcoding: SoundCloudTranscoding): number {
  if (!transcoding.url || transcoding.snipped) return -1;
  const protocol = transcoding.format?.protocol ?? "";
  const mime = transcoding.format?.mime_type ?? "";
  const preset = transcoding.preset ?? "";
  if (protocol.includes("encrypted")) return -1;

  let score = 0;
  if (protocol === "progressive") score += 80;
  if (protocol === "hls") score += 45;
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

export async function handleStream(config: SoundCloudConfig, trackId: string): Promise<SoundCloudStreamResult> {
  try {
    const track = await fetchTrack(config, trackId);
    if (!hasPlayableTranscoding(track)) {
      throw new AddonError("SoundCloud track is not available for off-platform streaming", 403);
    }

    const transcoding = chooseTranscoding(track);
    if (!transcoding?.url) {
      throw new AddonError("SoundCloud track has no supported transcoding", 404);
    }

    const resolved = await scFetch<{ url?: string }>(config, transcoding.url, {
      track_authorization: (track as any).track_authorization,
    });
    if (!resolved.url) {
      throw new AddonError("SoundCloud stream resolver returned no URL", 502);
    }

    const durationMs = track.full_duration ?? track.duration ?? transcoding.duration ?? null;
    return {
      url: resolved.url,
      bitrate: bitrateFor(transcoding),
      durationSeconds: durationMs ? Math.round(durationMs / 1000) : null,
      format: transcoding.format?.mime_type ?? null,
    };
  } catch (error: any) {
    console.error("[soundcloud:stream] Error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}
