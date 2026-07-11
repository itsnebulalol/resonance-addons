import { AddonError, type HistoryEvent } from "@resonance-addons/sdk";
import { invalidateResponseCache, mintAccessToken, ytFetch } from "../auth";

const CPN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

function generateCPN(): string {
  return Array.from({ length: 16 }, () => CPN_CHARS[(Math.random() * CPN_CHARS.length) | 0]).join("");
}

export async function handleHistory(refreshToken: string, videoId: string, _event: HistoryEvent): Promise<void> {
  try {
    const data = await ytFetch("player", refreshToken, {
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          signatureTimestamp: 20116,
        },
      },
    });
    const baseURL = data?.playbackTracking?.videostatsPlaybackUrl?.baseUrl;
    if (!baseURL) throw new AddonError("YouTube Music playback tracking is unavailable", 404);

    const url = new URL(baseURL);
    url.searchParams.set("ver", "2");
    url.searchParams.set("c", "IOS_MUSIC");
    url.searchParams.set("cpn", generateCPN());

    const accessToken = await mintAccessToken(refreshToken);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      throw new AddonError(`YouTube Music history failed (${response.status})`, response.status);
    }
    invalidateResponseCache(refreshToken);
  } catch (error: any) {
    console.error("[history] YouTube Music error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}
