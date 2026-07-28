import { amFetch, invalidateAMCache } from "./cached-fetch";
import type { ArtistRef, SearchAlbum, SearchArtist, SearchPlaylist, Track } from "./models";
import { StorefrontResolver } from "./storefront";
import { getDeveloperToken, getUserToken } from "./token";

export const PROVIDER_ID = "net.itsnebula.applemusic";
const AMP = "https://amp-api.music.apple.com";

function authHeaders(dev: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${dev}`,
    Origin: "https://music.apple.com",
    Referer: "https://music.apple.com/",
    Accept: "application/json",
  };
  const user = getUserToken();
  if (user) h["Music-User-Token"] = user;
  return h;
}

/** GET an Apple Music API path (relative to amp-api or absolute /v1/... or full https). Cached. */
export async function ampGet(path: string, params?: Record<string, string | number | undefined>): Promise<any> {
  const dev = await getDeveloperToken();
  let url = path.startsWith("http") ? path : `${AMP}${path.startsWith("/") ? "" : "/"}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
  const res = await amFetch(url, { headers: authHeaders(dev) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AM ${res.status} ${path.slice(0, 80)}: ${body.slice(0, 140)}`);
  }
  return res.json();
}

/** Mutating request (PUT/POST/DELETE). Returns {ok,status,json}. */
export async function ampSend(
  method: string,
  path: string,
  body?: any,
): Promise<{ ok: boolean; status: number; json: any }> {
  const dev = await getDeveloperToken();
  const url = path.startsWith("http") ? path : `${AMP}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method,
    headers: { ...authHeaders(dev), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (res.ok && method !== "GET") {
    invalidateAMCache();
  }
  return { ok: res.ok, status: res.status, json };
}

const storefrontResolver = new StorefrontResolver();

export async function getStorefront(): Promise<string> {
  const userToken = getUserToken()?.trim() ?? "";
  return storefrontResolver.resolve(userToken, async () => {
    const d = await ampGet("/v1/me/storefront");
    return d?.data?.[0]?.id;
  });
}

// ---------- mappers (Apple Music resource -> canonical model) ----------

export function artworkURL(art: any, size = 1200): string | null {
  if (!art?.url) return null;
  return String(art.url).replace("{w}", String(size)).replace("{h}", String(size)).replace("{c}", "bb");
}

export function msToDuration(ms?: number | null): string | null {
  if (!ms || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values = value.map(nonEmptyString).filter((item): item is string => item !== null);
  return values.length ? values : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function releaseYearOf(value: unknown): number | null {
  const date = nonEmptyString(value);
  if (!date) return null;
  const match = /\b\d{4}\b/.exec(date);
  if (!match) return null;
  const year = Number(match[0]);
  return year >= 1000 && year <= 9999 ? year : null;
}

function yearOf(dateStr?: string): string | null {
  const year = releaseYearOf(dateStr);
  return year === null ? null : String(year);
}

function relationshipArtists(song: any, fallbackName: string | null): ArtistRef[] {
  if (!Array.isArray(song?.relationships?.artists?.data)) return [];
  const data = song.relationships.artists.data;
  const artists = data.flatMap((artist: any) => {
    const name = nonEmptyString(artist?.attributes?.name);
    if (!name) return [];
    return [{ id: artist?.id == null ? null : String(artist.id), name }];
  });
  if (artists.length || data.length !== 1 || !fallbackName) return artists;
  return [{ id: data[0]?.id == null ? null : String(data[0].id), name: fallbackName }];
}

function namedArtist(name: string | null, candidates: ArtistRef[] = []): ArtistRef[] | null {
  if (!name) return null;
  const match = candidates.find((artist) => artist.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0);
  return [{ id: match?.id ?? null, name }];
}

interface SongTrackContext {
  album?: any;
}

/** Catalog `songs` OR `library-songs` -> Track. */
export function songToTrack(song: any, context: SongTrackContext = {}): Track {
  const a = song?.attributes ?? {};
  const catalogId: string = a.playParams?.catalogId ?? (song.type === "library-songs" ? "" : song.id);
  const id = catalogId || song.id;
  const relatedAlbum = song?.relationships?.albums?.data?.[0] ?? null;
  const albumAttributes = { ...(context.album?.attributes ?? {}), ...(relatedAlbum?.attributes ?? {}) };
  const albumId = relatedAlbum?.id ?? context.album?.id ?? a.playParams?.purchasedId ?? null;
  const albumName = nonEmptyString(a.albumName) ?? nonEmptyString(albumAttributes.name);
  const artistName = nonEmptyString(a.artistName);
  const includedArtists = relationshipArtists(song, artistName);
  const artists = includedArtists.length ? includedArtists : (namedArtist(artistName) ?? []);
  const albumArtists = namedArtist(
    nonEmptyString(a.albumArtistName) ?? nonEmptyString(albumAttributes.artistName),
    includedArtists,
  );
  const genres = stringList(a.genreNames) ?? stringList(albumAttributes.genreNames);
  const releaseYear = releaseYearOf(a.releaseDate) ?? releaseYearOf(albumAttributes.releaseDate);
  const trackNumber = positiveInteger(a.trackNumber);
  const trackTotal = positiveInteger(a.trackCount) ?? positiveInteger(albumAttributes.trackCount);
  const discNumber = positiveInteger(a.discNumber);
  const discTotal = positiveInteger(a.discCount) ?? positiveInteger(albumAttributes.discCount);
  const bpm = positiveNumber(a.bpm) ?? positiveNumber(a.beatsPerMinute);
  const musicalKey = nonEmptyString(a.musicalKey) ?? nonEmptyString(a.keySignature);
  return {
    id: String(id),
    provider: PROVIDER_ID,
    title: a.name ?? "",
    artists,
    album: albumName ? { id: albumId == null ? null : String(albumId), name: albumName } : null,
    duration: msToDuration(a.durationInMillis),
    durationSeconds: a.durationInMillis ? Math.round(a.durationInMillis / 1000) : null,
    thumbnailURL: artworkURL(a.artwork),
    isExplicit: a.contentRating === "explicit",
    ...(genres ? { genres } : {}),
    ...(releaseYear !== null ? { releaseYear } : {}),
    ...(albumArtists ? { albumArtists } : {}),
    ...(trackNumber !== null ? { trackNumber } : {}),
    ...(trackTotal !== null ? { trackTotal } : {}),
    ...(discNumber !== null ? { discNumber } : {}),
    ...(discTotal !== null ? { discTotal } : {}),
    ...(bpm !== null ? { bpm } : {}),
    ...(musicalKey ? { musicalKey } : {}),
  };
}

export function albumToSearch(album: any): SearchAlbum {
  const a = album?.attributes ?? {};
  const artists: ArtistRef[] = a.artistName ? [{ id: null, name: a.artistName }] : [];
  return {
    id: String(album.id),
    provider: PROVIDER_ID,
    title: a.name ?? "",
    artists,
    year: yearOf(a.releaseDate),
    thumbnailURL: artworkURL(a.artwork),
    isExplicit: a.contentRating === "explicit",
  };
}

export function playlistToSearch(pl: any): SearchPlaylist {
  const a = pl?.attributes ?? {};
  return {
    id: String(pl.id),
    provider: PROVIDER_ID,
    title: a.name ?? "",
    author: a.curatorName ?? null,
    trackCount: a.trackCount ? `${a.trackCount} songs` : null,
    thumbnailURL: artworkURL(a.artwork),
    canAddTracks: a.canEdit == null ? null : a.canEdit === true,
    canDelete: a.canEdit == null ? null : a.canEdit === true,
  };
}

export function artistToSearch(ar: any): SearchArtist {
  const a = ar?.attributes ?? {};
  return {
    id: String(ar.id),
    provider: PROVIDER_ID,
    name: a.name ?? "",
    thumbnailURL: artworkURL(a.artwork),
    subscriberCount: null,
  };
}

/** Map any AM resource object to a canonical HomeItem */
export function resourceToHomeItem(r: any): import("./models").HomeItem | null {
  const t = r?.type ?? "";
  if (t === "songs" || t === "library-songs") return { type: "track", track: songToTrack(r) };
  if (t === "albums" || t === "library-albums") return { type: "album", album: albumToSearch(r) };
  if (t === "playlists" || t === "library-playlists") return { type: "playlist", playlist: playlistToSearch(r) };
  if (t === "artists" || t === "library-artists") return { type: "artist", artist: artistToSearch(r) };
  if (t === "stations") {
    const a = r?.attributes ?? {};
    return {
      type: "station",
      station: {
        id: String(r.id),
        provider: PROVIDER_ID,
        title: a.name ?? "Station",
        subtitle: a.stationProviderName ?? "Station",
        thumbnailURL: artworkURL(a.artwork),
      },
    };
  }
  return null;
}

/** Map any AM resource object to a canonical SearchResultItem */
export function resourceToSearchItem(r: any): import("./models").SearchResultItem | null {
  const t = r?.type ?? "";
  if (t === "songs" || t === "library-songs") return { type: "track", track: songToTrack(r) };
  if (t === "albums" || t === "library-albums") return { type: "album", album: albumToSearch(r) };
  if (t === "playlists" || t === "library-playlists") return { type: "playlist", playlist: playlistToSearch(r) };
  if (t === "artists" || t === "library-artists") return { type: "artist", artist: artistToSearch(r) };
  return null;
}

/* Apple Music's real radio */
export async function radioNextTracks(stationId: string, limit = 10): Promise<Track[]> {
  const n = Math.max(1, Math.min(limit, 10));
  const r = await ampSend("POST", `/v1/me/stations/next-tracks/${stationId}?limit=${n}`);
  if (!r.ok) return [];
  return ((r.json?.data ?? []) as any[]).map((song) => songToTrack(song));
}

/** The continuous-play station id for a catalog song */
export const songStationId = (songId: string) => `ra.cp-${songId}`;
