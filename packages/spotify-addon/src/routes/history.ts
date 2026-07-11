import { AddonError, type HistoryEvent } from "@resonance-addons/sdk";
import { getAccessToken, getClientToken } from "../auth";
import { buildGaboHistoryRequest, parseGaboErrors } from "../gabo";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.179 Spotify/1.2.88.483 Safari/537.36";
const SPCLIENT = "https://spclient.wg.spotify.com";

function mediaHeaders(accessToken: string, clientToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "client-token": clientToken,
    "app-platform": "WebPlayer",
    "spotify-app-version": "1.2.80.313.gd1726b65",
    Origin: "https://open.spotify.com",
  };
}

export async function handleHistory(spDc: string, trackId: string, event: HistoryEvent): Promise<void> {
  try {
    const [accessToken, clientToken] = await Promise.all([getAccessToken(spDc), getClientToken()]);
    const uri = `spotify:track:${trackId}`;
    const mediaResponse = await fetch(
      `${SPCLIENT}/track-playback/v1/media/${uri}?manifestFileFormat=file_ids_mp4&manifestFileFormat=file_ids_mp4_dual`,
      { headers: mediaHeaders(accessToken, clientToken) },
    );
    if (!mediaResponse.ok) {
      throw new AddonError(`Spotify media metadata failed (${mediaResponse.status})`, mediaResponse.status);
    }
    const media: any = await mediaResponse.json();
    const item = media?.media?.[uri]?.item ?? Object.values(media?.media ?? {})[0]?.item;
    const file = [...(item?.manifest?.file_ids_mp4 ?? []), ...(item?.manifest?.file_ids_mp4_dual ?? [])].sort(
      (a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0),
    )[0];
    const contextURI =
      typeof item?.metadata?.group_uri === "string" && item.metadata.group_uri.startsWith("spotify:")
        ? item.metadata.group_uri
        : uri;
    const body = buildGaboHistoryRequest({
      credentialSeed: spDc,
      trackId,
      contextUri: contextURI,
      playbackId: event.playbackId,
      startedAtMs: Math.min(event.startedAtMs, event.reportedAtMs),
      listenedMs: Math.max(1, Math.round(event.listenedSeconds * 1000)),
      completed: event.completed,
      mediaFileId: file?.file_id,
    });
    const response = await fetch(`${SPCLIENT}/gabo-receiver-service/v3/events/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "client-token": clientToken,
        "App-Platform": "Win32_x86_64",
        "Spotify-App-Version": "128800483",
        "User-Agent": USER_AGENT,
        Origin: SPCLIENT,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Dest": "empty",
        "Accept-Language": "en",
        "Content-Type": "application/x-protobuf",
        "Content-Encoding": "gzip",
      },
      body,
    });
    if (!response.ok) {
      throw new AddonError(`Spotify history failed (${response.status})`, response.status);
    }
    const errors = parseGaboErrors(new Uint8Array(await response.arrayBuffer()));
    if (errors.length > 0) {
      const reasons = errors.map((error) => error.reason ?? "unknown").join(", ");
      throw new AddonError(`Spotify history was rejected (${reasons})`, 502);
    }
  } catch (error: any) {
    console.error("[history] Spotify error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}
