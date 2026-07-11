import { AddonError, type HistoryEvent } from "@resonance-addons/sdk";
import { fetchTrack, getClientId, requireOAuth, type SoundCloudConfig, type SoundCloudUser, scFetch } from "../api";

function rawOAuthToken(config: SoundCloudConfig): string {
  return (config.oauthToken ?? "").trim().replace(/^(OAuth|Bearer)\s+/i, "");
}

function randomAnalyticsID(): string {
  return crypto.randomUUID().replaceAll("-", "").toLowerCase();
}

export async function handleHistory(config: SoundCloudConfig, trackId: string, event: HistoryEvent): Promise<void> {
  try {
    requireOAuth(config);
    const token = rawOAuthToken(config);
    const [track, user] = await Promise.all([fetchTrack(config, trackId), scFetch<SoundCloudUser>(config, "/me")]);
    const trackURN = (track as any).urn;
    const trackAuthorization = (track as any).track_authorization;
    const trackOwner = (track.user as any)?.urn;
    if (!trackURN || !trackAuthorization || !trackOwner || !(user as any).urn) {
      throw new AddonError("SoundCloud history metadata is incomplete", 400);
    }

    const transcoding = track.media?.transcodings?.[0];
    const appVersion = String(Math.floor(event.reportedAtMs / 1000));
    const sessionID = event.playbackId;
    const anonymousID = crypto.randomUUID().toLowerCase();
    const analyticsID = randomAnalyticsID();
    const eventResponse = await fetch(`https://api-v2.soundcloud.com/me?client_id=${getClientId(config)}`, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${token}`,
        "Content-Type": "text/plain;charset=UTF-8",
        Origin: "https://soundcloud.com",
        Referer: "https://soundcloud.com/",
      },
      body: JSON.stringify({
        events: [
          {
            event: "audio",
            version: "v1.27.17",
            payload: {
              track_length: transcoding?.duration ?? track.full_duration ?? track.duration ?? undefined,
              track_authorization: trackAuthorization,
              player_type: "MaestroHLSMSE",
              preset: transcoding?.preset ?? undefined,
              quality: transcoding?.quality ?? undefined,
              app_state: "foreground",
              action: "play",
              trigger: "manual",
              track: trackURN,
              track_owner: trackOwner,
              playhead_position: Math.max(0, Math.round(event.positionSeconds * 1000)),
              anonymous_id: anonymousID,
              client_id: 46941,
              ts: event.startedAtMs,
              session_id: sessionID,
              analytics_id: analyticsID,
              app_version: appVersion,
              user: (user as any).urn,
            },
          },
        ],
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
