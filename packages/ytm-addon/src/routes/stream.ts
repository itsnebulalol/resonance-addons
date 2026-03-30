import { AddonError } from "@resonance-addons/sdk";
import { mintAccessToken, ytFetch } from "../auth";
import { resolveIFL } from "../ifl";
import type { StreamResult } from "../types";

export async function handleStream(refreshToken: string, videoId: string): Promise<StreamResult> {
  try {
    if (videoId === "_ifl") {
      videoId = await resolveIFL(refreshToken);
    }

    const data = await ytFetch("player", refreshToken, {
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

    const best = audioFormats.sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];

    if (!best.url) {
      throw new AddonError("Audio stream URL not available (cipher-protected)", 404);
    }

    const trackingBaseUrl = data?.playbackTracking?.videostatsPlaybackUrl?.baseUrl;
    let trackingURL: string | null = null;
    let trackingHeaders: Record<string, string> | null = null;
    if (trackingBaseUrl) {
      const tUrl = new URL(trackingBaseUrl);
      tUrl.searchParams.set("ver", "2");
      tUrl.searchParams.set("c", "IOS_MUSIC");
      tUrl.searchParams.set(
        "cpn",
        Array.from(
          { length: 16 },
          () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"[(Math.random() * 64) | 0],
        ).join(""),
      );
      trackingURL = tUrl.toString();
      const accessToken = await mintAccessToken(refreshToken);
      trackingHeaders = { Authorization: `Bearer ${accessToken}` };
    }

    return {
      url: best.url,
      bitrate: best.bitrate ?? null,
      durationSeconds: best.approxDurationMs ? Math.round(parseInt(best.approxDurationMs, 10) / 1000) : null,
      format: best.mimeType ?? null,
      trackingURL,
      trackingHeaders,
    };
  } catch (e: any) {
    console.error("Stream error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}
