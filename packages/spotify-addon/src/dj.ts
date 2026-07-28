import { AddonError } from "@resonance-addons/sdk";
import { getAccessToken } from "./auth";
import { fulfillTTSManifest, fulfillTTSRequestHex } from "./routes/tts";
import type { DJAudioPayload, DJNarrationPresentation, DJScript, QueueAction, QueuePage, Track } from "./types";
import { PROVIDER_ID } from "./utils";

export const DJ_CONTEXT_ID = "37i9dQZF1EYkqdzj48dyYq";

interface BackendArtist {
  id?: string | null;
  name: string;
}

interface BackendTrack {
  id: string;
  title: string;
  artists: BackendArtist[];
  album?: { id?: string | null; name: string } | null;
  durationSeconds?: number | null;
  thumbnailUrl?: string | null;
  isExplicit?: boolean;
}

interface BackendPage {
  tracks: BackendTrack[];
  narrationText?: string | null;
  narrationManifest?: string | null;
  narrationRequestHex?: string | null;
  narrationTitle?: string | null;
  narrationArtist?: string | null;
  narrationArtworkUrl?: string | null;
  jumpNarration?: BackendNarration | null;
  outroNarration?: BackendNarration | null;
  continuationToken?: string | null;
  switchToken?: string | null;
  canSwitch: boolean;
  exhausted?: boolean;
}

interface BackendNarration {
  text?: string | null;
  manifest?: string | null;
  requestHex?: string | null;
  title?: string | null;
  artist?: string | null;
  artworkUrl?: string | null;
}

interface StartEntry {
  promise: Promise<BackendPage>;
}

const pendingStarts = new Map<string, StartEntry>();
const narrationAudioCache = new Map<string, Promise<DJAudioPayload | null>>();
const MAX_NARRATION_AUDIO_CACHE_ENTRIES = 24;

function endpoint(serverUrl: string, path: string): URL {
  const value = serverUrl.trim();
  if (!value) throw new AddonError("Spotify streaming server URL is not configured", 400);
  const base = new URL(value.endsWith("/") ? value : `${value}/`);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new AddonError("Spotify streaming server URL must use HTTP or HTTPS", 400);
  }
  return new URL(path.replace(/^\/+/, ""), base.href);
}

async function requestBackend<T>(
  serverUrl: string,
  serverToken: string,
  path: string,
  body: Record<string, string>,
): Promise<T> {
  const response = await fetch(endpoint(serverUrl, path).href, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serverToken.trim()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new AddonError(
      `Spotify DJ server HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

async function startBackend(spDc: string, serverUrl: string, serverToken: string): Promise<BackendPage> {
  console.log("[dj] starting server session");
  if (!serverToken.trim()) throw new AddonError("Spotify streaming server token is not configured", 400);
  const accessToken = await getAccessToken(spDc);
  const page = await requestBackend<BackendPage>(serverUrl, serverToken, "v1/dj/start", { accessToken });
  const first = page.tracks[0]?.id;
  if (!first) throw new AddonError("Spotify DJ returned no tracks", 502);
  console.log(`[dj] session ready tracks=${page.tracks.length} switch=${page.canSwitch}`);
  return page;
}

export function resolveDJStart(spDc: string, serverUrl: string, serverToken: string): Promise<BackendPage> {
  return resolveDJStartRequest(spDc, () => startBackend(spDc, serverUrl, serverToken));
}

export function resolveDJStartRequest(key: string, start: () => Promise<BackendPage>): Promise<BackendPage> {
  const existing = pendingStarts.get(key);
  if (existing) {
    return existing.promise;
  }

  const entry: StartEntry = {
    promise: start(),
  };
  pendingStarts.set(key, entry);
  void entry.promise
    .finally(() => {
      if (pendingStarts.get(key) === entry) {
        pendingStarts.delete(key);
      }
    })
    .catch(() => {});
  return entry.promise;
}

function transformTrack(track: BackendTrack): Track {
  return {
    id: track.id,
    provider: PROVIDER_ID,
    title: track.title,
    artists: (track.artists ?? []).map((artist) => ({ id: artist.id ?? null, name: artist.name })),
    album: track.album ? { id: track.album.id ?? null, name: track.album.name } : null,
    duration: formatDuration(track.durationSeconds),
    durationSeconds: track.durationSeconds ?? null,
    thumbnailURL: track.thumbnailUrl ?? null,
    isExplicit: track.isExplicit ?? false,
  };
}

function formatDuration(seconds?: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function speakableText(ssml?: string | null): string | null {
  if (!ssml) return null;
  const text = ssml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function scriptFor(
  slots: Array<{
    trackId: string;
    narrationText?: string | null;
    audio?: DJAudioPayload | null;
    presentation?: DJNarrationPresentation | null;
    position: "beforeTrack" | "afterTrack";
  }>,
): DJScript | null {
  const resolved = slots.flatMap((slot) => {
    const text = speakableText(slot.narrationText);
    if (!text && !slot.audio) return [];
    return [
      {
        trackId: slot.trackId,
        text,
        audio: slot.audio,
        presentation: slot.presentation,
        position: slot.position,
      },
    ];
  });
  return resolved.length > 0 ? { slots: resolved } : null;
}

function mixItUpAction(token: string): QueueAction {
  return {
    id: "spotify-dj-switch",
    title: "Mix it up",
    isSelected: false,
    allowsPrefetch: false,
    isMomentary: true,
    shouldAdvancePlayback: true,
    isStationRetrigger: true,
    payload: {
      providerID: PROVIDER_ID,
      data: { type: "spotifyDjSwitch", token },
    },
  };
}

async function nativeNarrationAudio(
  spDc: string,
  manifest?: string | null,
  requestHex?: string | null,
): Promise<DJAudioPayload | null> {
  if (!manifest && !requestHex) return null;
  const key = manifest ? `manifest:${manifest}` : `request:${requestHex}`;
  const cached = narrationAudioCache.get(key);
  if (cached) return cached;
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), 8_000);
  });
  const pending = Promise.race([
    (manifest ? fulfillTTSManifest(spDc, manifest) : fulfillTTSRequestHex(spDc, requestHex!)).catch((error) => {
      console.warn(`[dj] native narration failed: ${String(error)}`);
      return null;
    }),
    timeout,
  ]);
  narrationAudioCache.set(key, pending);
  void pending.then((audio) => {
    if (!audio && narrationAudioCache.get(key) === pending) {
      narrationAudioCache.delete(key);
    }
  });
  while (narrationAudioCache.size > MAX_NARRATION_AUDIO_CACHE_ENTRIES) {
    const oldest = narrationAudioCache.keys().next().value;
    if (typeof oldest !== "string") break;
    narrationAudioCache.delete(oldest);
  }
  return pending;
}

async function queuePage(page: BackendPage, spDc: string): Promise<QueuePage> {
  if (page.exhausted) {
    return {
      tracks: [],
      continuation: null,
      actions: [],
      title: "DJ",
      likeStatus: null,
      playlistId: null,
      relatedBrowseId: null,
      djScript: null,
    };
  }
  const tracks = page.tracks.map(transformTrack);
  const firstTrackId = tracks[0]?.id;
  const lastTrackId = tracks.at(-1)?.id;
  const jumpAudio = nativeNarrationAudio(spDc, page.jumpNarration?.manifest, page.jumpNarration?.requestHex);
  const [entryAudio, outroAudio] = await Promise.all([
    nativeNarrationAudio(spDc, page.narrationManifest, page.narrationRequestHex),
    nativeNarrationAudio(spDc, page.outroNarration?.manifest, page.outroNarration?.requestHex),
  ]);
  void jumpAudio;
  const entryPresentation: DJNarrationPresentation = {
    title: page.narrationTitle ?? "Up next",
    artist: page.narrationArtist ?? "DJ X",
    artworkURL: page.narrationArtworkUrl ?? "https://lexicon-assets.spotifycdn.com/Your-DJ-Cover-Art-300.png",
  };
  const outroPresentation: DJNarrationPresentation = {
    title: page.outroNarration?.title ?? "Up next",
    artist: page.outroNarration?.artist ?? "DJ X",
    artworkURL: page.outroNarration?.artworkUrl ?? "https://lexicon-assets.spotifycdn.com/Your-DJ-Cover-Art-300.png",
  };
  const djScript =
    firstTrackId && lastTrackId
      ? scriptFor([
          {
            trackId: firstTrackId,
            narrationText: page.narrationText,
            audio: entryAudio,
            presentation: entryPresentation,
            position: "beforeTrack",
          },
          {
            trackId: lastTrackId,
            narrationText: page.outroNarration?.text,
            audio: outroAudio,
            presentation: outroPresentation,
            position: "afterTrack",
          },
        ])
      : null;
  if (!firstTrackId || !djScript?.slots.some((slot) => slot.position === "beforeTrack")) {
    throw new AddonError("Spotify DJ returned a section without narration", 502);
  }
  return {
    tracks,
    continuation: page.continuationToken
      ? {
          providerID: PROVIDER_ID,
          token: JSON.stringify({
            type: "dj",
            token: page.continuationToken,
          }),
        }
      : null,
    actions: page.canSwitch && page.switchToken ? [mixItUpAction(page.switchToken)] : [],
    title: "DJ",
    likeStatus: null,
    playlistId: null,
    relatedBrowseId: null,
    djScript,
  };
}

export async function startDJQueue(spDc: string, serverUrl: string, serverToken: string): Promise<QueuePage> {
  return queuePage(await resolveDJStart(spDc, serverUrl, serverToken), spDc);
}

export async function continueDJQueue(
  spDc: string,
  serverUrl: string,
  serverToken: string,
  token: string,
): Promise<QueuePage> {
  console.log("[dj] loading continuation");
  const page = await requestBackend<BackendPage>(serverUrl, serverToken, "v1/dj/continue", { token });
  return queuePage(page, spDc);
}

export async function switchDJQueue(
  spDc: string,
  serverUrl: string,
  serverToken: string,
  token: string,
  currentTrackId?: string | null,
): Promise<QueuePage> {
  console.log("[dj] switching section");
  const body: Record<string, string> = { token };
  if (currentTrackId) body.currentTrackId = currentTrackId;
  const page = await requestBackend<BackendPage>(serverUrl, serverToken, "v1/dj/switch", body);
  return queuePage(page, spDc);
}
