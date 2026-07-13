import { AddonError, type HistoryEvent } from "@resonance-addons/sdk";
import {
  fetchTrack,
  getClientId,
  requireOAuth,
  type SoundCloudConfig,
  type SoundCloudTrack,
  type SoundCloudTranscoding,
  type SoundCloudUser,
  scFetch,
} from "../api";

const EVENT_GATEWAY_VERSION = "v1.27.47";

function rawOAuthToken(config: SoundCloudConfig): string {
  return (config.oauthToken ?? "").trim().replace(/^(OAuth|Bearer)\s+/i, "");
}

function chooseTranscoding(track: SoundCloudTrack): SoundCloudTranscoding | null {
  const transcodings = track.media?.transcodings ?? [];
  return (
    transcodings.find((item) => item.format?.protocol === "progressive" && !item.snipped) ??
    transcodings.find((item) => !item.format?.protocol?.includes("encrypted") && !item.snipped) ??
    null
  );
}

function anonymousID(): string {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 1_000_000)).join("-");
}

export async function handleHistory(config: SoundCloudConfig, trackId: string, event: HistoryEvent): Promise<void> {
  try {
    requireOAuth(config);
    const [track, user] = await Promise.all([fetchTrack(config, trackId), scFetch<SoundCloudUser>(config, "/me")]);
    const trackURN = track.urn;
    const trackOwnerURN = track.user?.urn;
    const userURN = user.urn;
    const transcoding = chooseTranscoding(track);
    if (!trackURN || !trackOwnerURN || !userURN || !track.track_authorization || !transcoding) {
      throw new AddonError("SoundCloud history metadata is incomplete", 400);
    }

    const token = rawOAuthToken(config);
    const protocol = transcoding.format?.protocol ?? "progressive";
    const eventResponse = await fetch(`https://api-v2.soundcloud.com/me?client_id=${getClientId(config)}`, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${token}`,
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: JSON.stringify({
        events: [
          {
            event: "audio",
            version: EVENT_GATEWAY_VERSION,
            payload: {
              track_length: transcoding.duration ?? track.full_duration ?? track.duration,
              track_authorization: track.track_authorization,
              protocol,
              player_type: protocol === "progressive" ? "MaestroHTML5" : "MaestroHLSMSE",
              preset: transcoding.preset,
              quality: transcoding.quality,
              audio_quality_mode: "standard",
              app_state: "foreground",
              action: "play",
              trigger: "manual",
              track: trackURN,
              track_owner: trackOwnerURN,
              playhead_position: 0,
              policy: track.policy,
              monetization_model: track.monetization_model,
              anonymous_id: anonymousID(),
              client_id: 46941,
              ts: event.startedAtMs,
              url: track.permalink_url ?? "https://soundcloud.com/",
              session_id: event.playbackId,
              analytics_id: user.analytics_id,
              app_version: String(Math.floor(event.reportedAtMs / 1000)),
              user: userURN,
            },
          },
        ],
        sent_at: new Date(event.reportedAtMs).toISOString(),
        auth_token: token,
      }),
    });
    if (!eventResponse.ok) {
      throw new AddonError(`SoundCloud play event failed (${eventResponse.status})`, eventResponse.status);
    }

    await scFetch(config, "/me/play-history", undefined, {
      method: "POST",
      body: JSON.stringify({ track_urn: trackURN }),
    });
  } catch (error: any) {
    console.error("[history] SoundCloud error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}
