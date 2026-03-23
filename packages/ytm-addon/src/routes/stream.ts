import { mintAccessToken, ytFetch } from "../auth";
import { resolveIFL } from "../ifl";
import type { StreamResult } from "../types";
import { errorResponse, json } from "../utils";

const CPN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

function generateCpn(): string {
  return Array.from({ length: 16 }, () => CPN_CHARS[(Math.random() * 64) | 0]).join("");
}

async function reportPlayback(trackingBaseUrl: string, refreshToken: string): Promise<void> {
  const accessToken = await mintAccessToken(refreshToken);

  const url = new URL(trackingBaseUrl);
  url.searchParams.set("ver", "2");
  url.searchParams.set("c", "IOS_MUSIC");
  url.searchParams.set("cpn", generateCpn());

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 204) {
    console.log("[tracking] Play recorded");
  } else {
    console.warn(`[tracking] Unexpected status ${res.status}`);
  }
}

export async function handleStream(refreshToken: string, videoId: string): Promise<Response> {
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
      return errorResponse(
        `Playback not available: ${data?.playabilityStatus?.reason ?? data?.playabilityStatus?.status}`,
        404,
      );
    }

    const trackingUrl = data?.playbackTracking?.videostatsPlaybackUrl?.baseUrl;
    if (trackingUrl) {
      reportPlayback(trackingUrl, refreshToken).catch((e: any) => {
        console.error("[tracking] Failed to report play:", e.message);
      });
    }

    const formats = data?.streamingData?.adaptiveFormats ?? [];
    const audioFormats = formats.filter((f: any) => f.mimeType?.startsWith("audio/"));

    if (audioFormats.length === 0) {
      return errorResponse("No audio stream found", 404);
    }

    const best = audioFormats.sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];

    if (!best.url) {
      return errorResponse("Audio stream URL not available (cipher-protected)", 404);
    }

    const result: StreamResult = {
      url: best.url,
      bitrate: best.bitrate ?? null,
      durationSeconds: best.approxDurationMs ? Math.round(parseInt(best.approxDurationMs, 10) / 1000) : null,
      format: best.mimeType ?? null,
    };

    return json(result);
  } catch (e: any) {
    console.error("Stream error:", e.message);
    return errorResponse(e.message, 500);
  }
}
