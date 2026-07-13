import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import { resolveIFL } from "../ifl";
import type { StreamResult, YouTubeMusicConfig } from "../types";

export async function handleStream(config: YouTubeMusicConfig, videoId: string): Promise<StreamResult> {
  try {
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
    const audioFormats = formats.filter((f: any) => f.mimeType?.startsWith("audio/"));

    if (audioFormats.length === 0) {
      throw new AddonError("No audio stream found", 404);
    }

    const avPlayerFormats = audioFormats.filter((f: any) => f.mimeType?.startsWith("audio/mp4"));
    const best = (avPlayerFormats.length > 0 ? avPlayerFormats : audioFormats).sort(
      (a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0),
    )[0];

    if (!best.url) {
      throw new AddonError("Audio stream URL not available (cipher-protected)", 404);
    }

    return {
      url: best.url,
      bitrate: best.bitrate ?? null,
      durationSeconds: best.approxDurationMs ? Math.round(parseInt(best.approxDurationMs, 10) / 1000) : null,
      format: best.mimeType?.split(";")[0] ?? null,
    };
  } catch (e: any) {
    console.error("Stream error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}
