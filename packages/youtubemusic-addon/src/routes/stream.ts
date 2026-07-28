import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import { resolveIFL } from "../ifl";
import type { StreamDescriptor, YouTubeMusicConfig } from "../types";
import { PROVIDER_ID } from "../utils";

const YOUTUBE_MUSIC_CDN_HEADERS: Record<string, string> = {
  Accept: "*/*",
  "Accept-Encoding": "identity",
  Origin: "https://www.youtube.com",
  Range: "bytes=0-",
  Referer: "https://www.youtube.com/",
  "User-Agent": "com.google.ios.youtubemusic/9.06.4 iSL/3.4 iPhone/26.2.1 hw/iPhone18_4 (gzip)",
};

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = positiveNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function queryInteger(url: string, key: string): number | null {
  try {
    return positiveInteger(new URL(url).searchParams.get(key));
  } catch {
    return null;
  }
}

function isClearProgressiveMP4(format: any): boolean {
  const mimeType = String(format?.mimeType ?? "").toLowerCase();
  const hasDRM =
    Boolean(format?.drmTrackType || format?.keyId || format?.cipher || format?.signatureCipher) ||
    (Array.isArray(format?.drmFamilies) && format.drmFamilies.length > 0) ||
    (Array.isArray(format?.licenseInfos) && format.licenseInfos.length > 0);

  return (
    typeof format?.url === "string" &&
    format.url.length > 0 &&
    mimeType.startsWith("audio/mp4") &&
    format?.type !== "FORMAT_STREAM_TYPE_OTF" &&
    !hasDRM
  );
}

export async function handleStream(config: YouTubeMusicConfig, videoId: string): Promise<StreamDescriptor> {
  try {
    const isEphemeral = videoId === "_ifl";
    if (videoId === "_ifl") {
      videoId = await resolveIFL(config);
    }

    const data = await ytFetch("player", config, {
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          signatureTimestamp: 20116,
        },
      },
    });

    if (data?.playabilityStatus?.status !== "OK") {
      throw new AddonError(
        `Playback not available: ${data?.playabilityStatus?.reason ?? data?.playabilityStatus?.status}`,
        404,
      );
    }

    const formats = data?.streamingData?.adaptiveFormats ?? [];
    const progressiveMP4Formats = formats
      .filter(isClearProgressiveMP4)
      .sort(
        (a: any, b: any) =>
          (positiveNumber(b.averageBitrate) ?? positiveNumber(b.bitrate) ?? 0) -
          (positiveNumber(a.averageBitrate) ?? positiveNumber(a.bitrate) ?? 0),
      );
    const best = progressiveMP4Formats[0];

    if (!best?.url) {
      throw new AddonError("No clear progressive audio/mp4 stream found", 404);
    }

    const durationMilliseconds = positiveNumber(best.approxDurationMs);
    const contentLength = positiveInteger(best.contentLength) ?? queryInteger(best.url, "clen");
    const expiresAtSeconds = queryInteger(best.url, "expire");

    return {
      schemaVersion: 1,
      state: "ready",
      url: best.url,
      transport: "progressive",
      container: "mp4",
      codec: "aac",
      requestHeaders: { ...YOUTUBE_MUSIC_CDN_HEADERS },
      bitrate: positiveInteger(best.averageBitrate) ?? positiveInteger(best.bitrate),
      durationSeconds: durationMilliseconds === null ? null : durationMilliseconds / 1000,
      contentLength,
      sampleRate: positiveNumber(best.audioSampleRate),
      bitDepth: null,
      channelCount: positiveInteger(best.audioChannels),
      rangeSupport: "bytes",
      seekMode: "byteRange",
      expiresAtUnixMilliseconds: expiresAtSeconds === null ? null : expiresAtSeconds * 1000,
      cacheIdentity: `${PROVIDER_ID}:stream:${videoId}:itag:${best.itag ?? "audio-mp4"}`,
      cachePolicy: isEphemeral ? "ephemeral" : "cacheable",
      partialPersistence: isEphemeral ? "none" : "validatedRanges",
      preparation: null,
    };
  } catch (e: any) {
    console.error("Stream error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}
