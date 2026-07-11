import { AddonError, type HistoryEvent } from "@resonance-addons/sdk";
import { getStorefront } from "../amapi";
import { getDeveloperToken, getUserToken } from "../token";

const HISTORY_URL = "https://universal-activity-service.itunes.apple.com/play";
const USER_AGENT = "Mozilla/5.0";

function compactID(value: string): string {
  const compact = value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return (compact + crypto.randomUUID().replaceAll("-", "")).slice(0, 16);
}

export async function handleHistory(trackId: string, event: HistoryEvent): Promise<void> {
  try {
    const [developerToken, storefront] = await Promise.all([getDeveloperToken(), getStorefront()]);
    const userToken = getUserToken();
    if (!userToken) throw new AddonError("Apple Music user token is not configured", 401);

    const durationMs = Math.max(0, Math.round((event.durationSeconds ?? event.positionSeconds) * 1000));
    const positionMs = Math.max(0, Math.round(event.positionSeconds * 1000));
    const common = {
      "build-version": "AppleMusic/1.0 macOS/10.15.7 model/MacIntel build/2628.7.0-external",
      "container-type": 0,
      "developer-token": developerToken,
      "feature-name": "music_kit-integration",
      ids: { "subscription-adam-id": trackId },
      "internal-build": false,
      "media-duration-in-milliseconds": durationMs,
      "media-type": 0,
      offline: false,
      "private-enabled": false,
      "sb-enabled": true,
      "siri-initiated": false,
      "source-type": 16,
      "start-position-in-milliseconds": 0,
      "store-front": storefront,
      type: 1,
      "user-agent": USER_AGENT,
      "user-token": userToken,
      "utc-offset-in-seconds": -new Date().getTimezoneOffset() * 60,
    };
    const events = [
      {
        ...common,
        "event-reason-hint-type": 0,
        "event-type": 1,
        "persistent-id": compactID(crypto.randomUUID()),
        "milliseconds-since-play": Math.max(0, event.reportedAtMs - event.startedAtMs),
      },
      {
        ...common,
        "end-position-in-milliseconds": positionMs,
        "end-reason-type": event.completed ? 7 : 3,
        "event-type": 0,
        "persistent-id": compactID(crypto.randomUUID()),
        "milliseconds-since-play": 0,
      },
    ];
    const response = await fetch(HISTORY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${developerToken}`,
        "media-user-token": userToken,
        "Content-Type": "application/json",
        Origin: "https://music.apple.com",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        client_id: "JSCLIENT",
        event_type: "JSPLAY",
        data: events,
      }),
    });
    if (!response.ok) {
      throw new AddonError(`Apple Music history failed (${response.status})`, response.status);
    }
  } catch (error: any) {
    console.error("[history] Apple Music error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}
