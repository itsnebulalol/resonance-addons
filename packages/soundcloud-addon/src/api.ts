import { AddonError } from "@resonance-addons/sdk";
import type { HomeItem, SearchAlbum, SearchArtist, SearchPlaylist, SearchResultItem, Track } from "./types";

export const PROVIDER_ID = "net.itsnebula.soundcloud";
export const DEFAULT_CLIENT_ID = "lmRjTI0FqeXygHMXc3hRzS7hth20PNk5";

const API_BASE = "https://api-v2.soundcloud.com";
const TRACK_HYDRATE_CHUNK_SIZE = 50;
const TRACK_HYDRATE_FALLBACK_CONCURRENCY = 8;

export interface SoundCloudConfig {
  oauthToken?: string;
}

export interface SoundCloudCollection<T = any> {
  collection?: T[];
  next_href?: string | null;
}

export interface SoundCloudUser {
  id?: number | string;
  urn?: string | null;
  analytics_id?: string | null;
  username?: string | null;
  full_name?: string | null;
  description?: string | null;
  avatar_url?: string | null;
  followers_count?: number | null;
  track_count?: number | null;
  playlist_count?: number | null;
  likes_count?: number | null;
  kind?: string | null;
}

export interface SoundCloudTranscoding {
  url?: string | null;
  preset?: string | null;
  quality?: string | null;
  snipped?: boolean | null;
  duration?: number | null;
  format?: {
    protocol?: string | null;
    mime_type?: string | null;
  } | null;
}

export interface SoundCloudTrack {
  id?: number | string;
  urn?: string | null;
  track_authorization?: string | null;
  policy?: string | null;
  monetization_model?: string | null;
  kind?: string | null;
  title?: string | null;
  description?: string | null;
  permalink_url?: string | null;
  artwork_url?: string | null;
  waveform_url?: string | null;
  duration?: number | null;
  full_duration?: number | null;
  streamable?: boolean | null;
  genre?: string | null;
  tag_list?: string | null;
  label_name?: string | null;
  release_date?: string | null;
  display_date?: string | null;
  likes_count?: number | null;
  playback_count?: number | null;
  comment_count?: number | null;
  user?: SoundCloudUser | null;
  publisher_metadata?: {
    album_title?: string | null;
    artist?: string | null;
    explicit?: boolean | null;
    isrc?: string | null;
    publisher?: string | null;
    writer_composer?: string | null;
  } | null;
  media?: {
    transcodings?: SoundCloudTranscoding[] | null;
  } | null;
}

export interface SoundCloudPlaylist {
  id?: number | string;
  kind?: string | null;
  title?: string | null;
  description?: string | null;
  permalink_url?: string | null;
  artwork_url?: string | null;
  duration?: number | null;
  track_count?: number | null;
  set_type?: string | null;
  is_album?: boolean | null;
  release_date?: string | null;
  display_date?: string | null;
  published_at?: string | null;
  user?: SoundCloudUser | null;
  tracks?: SoundCloudTrack[] | null;
}

export function hasOAuth(config: SoundCloudConfig): boolean {
  return Boolean(config.oauthToken?.trim());
}

export function getClientId(_config: SoundCloudConfig): string {
  return DEFAULT_CLIENT_ID;
}

export async function scFetch<T = any>(
  config: SoundCloudConfig,
  pathOrUrl: string,
  params?: Record<string, string | number | boolean | null | undefined>,
  init?: RequestInit,
): Promise<T> {
  const url = new URL(
    pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`,
  );

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("client_id", getClientId(config));

  const headers: Record<string, string> = { Accept: "application/json" };
  const token = config.oauthToken?.trim();
  if (token) headers.Authorization = /^(OAuth|Bearer)\s+/i.test(token) ? token : `OAuth ${token}`;
  if (init?.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const response = await fetch(url.toString(), {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new AddonError(`SoundCloud ${response.status}: ${errorMessage(data)}`, response.status);
  }

  return data as T;
}

export function requireOAuth(config: SoundCloudConfig): void {
  if (!hasOAuth(config)) {
    throw new AddonError("SoundCloud OAuth token is required for this action", 401);
  }
}

export async function fetchTrack(config: SoundCloudConfig, trackIdOrUrl: string): Promise<SoundCloudTrack> {
  const value = trackIdOrUrl.trim();
  if (/^https?:\/\//i.test(value)) {
    const resolved = await scFetch<SoundCloudTrack | SoundCloudPlaylist | SoundCloudUser>(config, "/resolve", {
      url: value,
    });
    if (resolved.kind !== "track") throw new AddonError("SoundCloud URL did not resolve to a track", 404);
    return resolved as SoundCloudTrack;
  }
  return scFetch<SoundCloudTrack>(config, `/tracks/${encodeURIComponent(value)}`);
}

export async function hydrateTracks(config: SoundCloudConfig, tracks: SoundCloudTrack[]): Promise<SoundCloudTrack[]> {
  const ids = Array.from(
    new Set(
      tracks
        .filter(trackNeedsHydration)
        .map((track) => soundCloudTrackId(track))
        .filter((id): id is string => Boolean(id)),
    ),
  );

  if (!ids.length) return tracks;

  const hydrated = new Map<string, SoundCloudTrack>();
  for (const chunk of chunks(ids, TRACK_HYDRATE_CHUNK_SIZE)) {
    try {
      for (const track of await fetchTracksByIds(config, chunk)) {
        const id = soundCloudTrackId(track);
        if (id) hydrated.set(id, track);
      }
    } catch {}
  }

  const unresolved = ids.filter((id) => {
    const track = hydrated.get(id);
    return !track || trackNeedsHydration(track);
  });
  for (const chunk of chunks(unresolved, TRACK_HYDRATE_FALLBACK_CONCURRENCY)) {
    await Promise.all(
      chunk.map(async (id) => {
        try {
          hydrated.set(id, await fetchTrack(config, id));
        } catch {}
      }),
    );
  }

  return tracks.map((track) => {
    const id = soundCloudTrackId(track);
    const richer = id ? hydrated.get(id) : null;
    return richerTrack(track, richer);
  });
}

export async function fetchPlaylist(config: SoundCloudConfig, playlistIdOrUrl: string): Promise<SoundCloudPlaylist> {
  const value = playlistIdOrUrl.trim();
  if (/^https?:\/\//i.test(value)) {
    const resolved = await scFetch<SoundCloudTrack | SoundCloudPlaylist | SoundCloudUser>(config, "/resolve", {
      url: value,
    });
    if (resolved.kind !== "playlist") throw new AddonError("SoundCloud URL did not resolve to a playlist", 404);
    return resolved as SoundCloudPlaylist;
  }
  return scFetch<SoundCloudPlaylist>(config, `/playlists/${encodeURIComponent(value)}`);
}

async function fetchTracksByIds(config: SoundCloudConfig, ids: string[]): Promise<SoundCloudTrack[]> {
  if (!ids.length) return [];
  const data = await scFetch<SoundCloudTrack[] | SoundCloudCollection<SoundCloudTrack>>(config, "/tracks", {
    ids: ids.join(","),
  });
  return Array.isArray(data) ? data : (data.collection ?? []);
}

export async function fetchUser(config: SoundCloudConfig, userIdOrUrl: string): Promise<SoundCloudUser> {
  const value = userIdOrUrl.trim();
  if (/^https?:\/\//i.test(value)) {
    const resolved = await scFetch<SoundCloudTrack | SoundCloudPlaylist | SoundCloudUser>(config, "/resolve", {
      url: value,
    });
    if (resolved.kind !== "user") throw new AddonError("SoundCloud URL did not resolve to a user", 404);
    return resolved as SoundCloudUser;
  }
  return scFetch<SoundCloudUser>(config, `/users/${encodeURIComponent(value)}`);
}

export function isAlbumSet(playlist: SoundCloudPlaylist): boolean {
  const setType = playlist.set_type?.toLowerCase() ?? "";
  return playlist.is_album === true || setType === "album" || setType === "ep" || setType === "single";
}

export function trackToTrack(track: SoundCloudTrack): Track {
  const id = String(track.id ?? "");
  const durationMs = track.full_duration ?? track.duration ?? null;
  const artistName = trackDisplayArtistName(track) || "Unknown";
  const userId = track.user?.id === undefined || track.user?.id === null ? null : String(track.user.id);
  const albumTitle = track.publisher_metadata?.album_title?.trim();

  return {
    id,
    provider: PROVIDER_ID,
    title: track.title ?? "",
    artists: [{ id: userId, name: artistName }],
    album: albumTitle ? { id: null, name: albumTitle } : null,
    duration: msToDuration(durationMs),
    durationSeconds: msToSeconds(durationMs),
    thumbnailURL: artworkURL(track.artwork_url) ?? artworkURL(track.user?.avatar_url),
    isExplicit:
      track.publisher_metadata?.explicit === true ||
      (track as any).explicit === true ||
      (track as any).content_rating === "explicit",
  };
}

export function userToSearchArtist(user: SoundCloudUser): SearchArtist {
  return {
    id: String(user.id ?? ""),
    provider: PROVIDER_ID,
    name: userDisplayName(user) || "Unknown",
    thumbnailURL: artworkURL(user.avatar_url),
    subscriberCount: countText(user.followers_count, "follower"),
  };
}

export function playlistToSearchPlaylist(playlist: SoundCloudPlaylist, currentUserId?: string | null): SearchPlaylist {
  return {
    id: String(playlist.id ?? ""),
    provider: PROVIDER_ID,
    title: playlist.title ?? "",
    author: userDisplayName(playlist.user),
    trackCount: countText(playlist.track_count, "track"),
    thumbnailURL:
      artworkURL(playlist.artwork_url) ??
      artworkURL(playlist.tracks?.[0]?.artwork_url) ??
      artworkURL(playlist.user?.avatar_url),
    canAddTracks:
      currentUserId == null || playlist.user?.id == null ? null : String(playlist.user.id) === currentUserId,
  };
}

export function playlistToSearchAlbum(playlist: SoundCloudPlaylist): SearchAlbum {
  return {
    id: String(playlist.id ?? ""),
    provider: PROVIDER_ID,
    title: playlist.title ?? "",
    artists: userDisplayName(playlist.user)
      ? [{ id: playlist.user?.id == null ? null : String(playlist.user.id), name: userDisplayName(playlist.user)! }]
      : [],
    year: yearOf(playlist.release_date ?? playlist.display_date ?? playlist.published_at),
    thumbnailURL:
      artworkURL(playlist.artwork_url) ??
      artworkURL(playlist.tracks?.[0]?.artwork_url) ??
      artworkURL(playlist.user?.avatar_url),
    isExplicit: false,
  };
}

export function resourceToHomeItem(resource: any): HomeItem | null {
  if (!resource) return null;
  if (resource.track && resource.track.kind === "track") return resourceToHomeItem(resource.track);
  if (resource.kind === "track") return { type: "track", track: trackToTrack(resource) };
  if (resource.kind === "user") return { type: "artist", artist: userToSearchArtist(resource) };
  if (resource.kind === "playlist") {
    if (isAlbumSet(resource)) return { type: "album", album: playlistToSearchAlbum(resource) };
    return { type: "playlist", playlist: playlistToSearchPlaylist(resource) };
  }
  return null;
}

export function resourceToSearchItem(
  resource: any,
  playlistMode: "auto" | "album" | "playlist" = "auto",
): SearchResultItem | null {
  if (!resource) return null;
  if (resource.track && resource.track.kind === "track") return resourceToSearchItem(resource.track, playlistMode);
  if (resource.kind === "track") return { type: "track", track: trackToTrack(resource) };
  if (resource.kind === "user") return { type: "artist", artist: userToSearchArtist(resource) };
  if (resource.kind === "playlist") {
    if (playlistMode === "album" || (playlistMode === "auto" && isAlbumSet(resource))) {
      return { type: "album", album: playlistToSearchAlbum(resource) };
    }
    return { type: "playlist", playlist: playlistToSearchPlaylist(resource) };
  }
  return null;
}

export async function playlistTracks(config: SoundCloudConfig, playlist: SoundCloudPlaylist): Promise<Track[]> {
  return soundCloudTracksToTracks(await hydrateTracks(config, playlist.tracks ?? []));
}

export function soundCloudTracksToTracks(tracks: SoundCloudTrack[]): Track[] {
  return displayableTracks(tracks)
    .filter((track) => track?.kind === "track" && track.id !== undefined && track.id !== null)
    .map(trackToTrack);
}

export function displayableTracks(tracks: SoundCloudTrack[]): SoundCloudTrack[] {
  return tracks.filter((track) => Boolean(track?.title?.trim() && trackDisplayArtistName(track)));
}

export function playableTracks(tracks: SoundCloudTrack[]): SoundCloudTrack[] {
  return tracks.filter(hasPlayableTranscoding);
}

export function hasPlayableTranscoding(track: SoundCloudTrack): boolean {
  if (track.streamable === false) return false;
  return (track.media?.transcodings ?? []).some((transcoding) => {
    const protocol = transcoding.format?.protocol ?? "";
    return Boolean(transcoding.url && !transcoding.snipped && !protocol.includes("encrypted"));
  });
}

export function artworkURL(url?: string | null, size = "t500x500"): string | null {
  if (!url) return null;
  return url.replace(/-(?:large|t\d+x\d+|crop|small|tiny|mini|badge)(\.[a-z0-9]+)(\?.*)?$/i, `-${size}$1$2`);
}

export function msToSeconds(ms?: number | null): number | null {
  if (!ms || ms <= 0) return null;
  return Math.round(ms / 1000);
}

export function msToDuration(ms?: number | null): string | null {
  const total = msToSeconds(ms);
  if (!total) return null;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function yearOf(value?: string | null): string | null {
  if (!value) return null;
  return /\b(19|20)\d{2}\b/.exec(value)?.[0] ?? null;
}

export function countText(count?: number | null, noun = "track"): string | null {
  if (typeof count !== "number") return null;
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

export function userDisplayName(user?: SoundCloudUser | null): string | null {
  return user?.username?.trim() || user?.full_name?.trim() || null;
}

function trackDisplayArtistName(track: SoundCloudTrack): string | null {
  return track.publisher_metadata?.artist?.trim() || userDisplayName(track.user);
}

function soundCloudTrackId(track?: SoundCloudTrack | null): string | null {
  if (track?.id === undefined || track.id === null) return null;
  return String(track.id);
}

function trackNeedsHydration(track: SoundCloudTrack): boolean {
  return Boolean(
    soundCloudTrackId(track) &&
      (!track.title?.trim() || !trackDisplayArtistName(track) || !(track.media?.transcodings?.length ?? 0)),
  );
}

function richerTrack(original: SoundCloudTrack, candidate?: SoundCloudTrack | null): SoundCloudTrack {
  if (!candidate) return original;
  return trackCompletenessScore(candidate) >= trackCompletenessScore(original) ? candidate : original;
}

function trackCompletenessScore(track: SoundCloudTrack): number {
  return (
    (track.title?.trim() ? 1 : 0) +
    (trackDisplayArtistName(track) ? 1 : 0) +
    ((track.media?.transcodings?.length ?? 0) > 0 ? 1 : 0) +
    ((track.full_duration ?? track.duration ?? 0) > 0 ? 1 : 0) +
    (track.artwork_url || track.user?.avatar_url ? 1 : 0)
  );
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function dedupeSearchItems(items: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value =
      item.type === "track"
        ? item.track.id
        : item.type === "artist"
          ? item.artist.id
          : item.type === "album"
            ? item.album.id
            : item.playlist.id;
    const key = `${item.type}:${value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function errorMessage(data: any): string {
  if (!data) return "request failed";
  if (typeof data === "string") return data.slice(0, 180);
  if (typeof data.message === "string") return data.message;
  if (Array.isArray(data.errors)) {
    return data.errors
      .map((error: any) =>
        typeof error === "string" ? error : (error?.error_message ?? error?.message ?? String(error)),
      )
      .join(", ");
  }
  return JSON.stringify(data).slice(0, 180);
}
