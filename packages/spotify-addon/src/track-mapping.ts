import { getAccessToken, spotifyFetch } from "./auth";
import type { ArtistRef, HomeSection, SpotifyAudioFeatures, SpotifyTrack, Track } from "./types";
import { bestImageFromSources, formatDurationMs, PROVIDER_ID, uriToId } from "./utils";

const SPOTIFY_API = "https://api.spotify.com/v1";
const CAMELOT_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const CAMELOT_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

interface GraphQLTrackContext {
  albumData?: any;
  trackEntry?: any;
  fallbackAlbumId?: string;
  trackTotal?: number | null;
  discTotal?: number | null;
}

export interface SpotifyTrackEnrichment {
  audioFeatures?: SpotifyAudioFeatures | null;
  albumData?: any;
  artistsById?: ReadonlyMap<string, any>;
}

function arrayItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function artistRefs(value: any): ArtistRef[] {
  return arrayItems(value)
    .map((artist: any) => {
      const data = artist?.data ?? artist;
      const name = data?.profile?.name ?? data?.name;
      if (typeof name !== "string" || !name.trim()) return null;
      const uri = data?.uri as string | undefined;
      const id = data?.id ?? (uri ? uriToId(uri) : null);
      return { id: typeof id === "string" && id ? id : null, name };
    })
    .filter((artist: ArtistRef | null): artist is ArtistRef => artist != null);
}

function imageSources(value: any): any[] {
  if (Array.isArray(value?.coverArt?.sources)) return value.coverArt.sources;
  if (Array.isArray(value?.images)) return value.images;
  return [];
}

function firstFiniteNumber(...values: any[]): number | undefined {
  for (const value of values) {
    const number = typeof value === "string" && value.trim() ? Number(value) : value;
    if (typeof number === "number" && Number.isFinite(number)) return number;
  }
  return undefined;
}

function positiveInteger(...values: any[]): number | undefined {
  const value = firstFiniteNumber(...values);
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function positiveNumber(...values: any[]): number | undefined {
  const value = firstFiniteNumber(...values);
  return value !== undefined && value > 0 ? value : undefined;
}

function yearFrom(...values: any[]): number | undefined {
  for (const value of values) {
    const year = typeof value === "number" ? value : Number.parseInt(String(value ?? "").slice(0, 4), 10);
    if (Number.isInteger(year) && year >= 1000 && year <= 9999) return year;
  }
  return undefined;
}

function stringValue(...values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function genreValues(value: any): string[] {
  const raw = Array.isArray(value) ? value : arrayItems(value);
  return raw
    .map((genre: any) => (typeof genre === "string" ? genre : (genre?.name ?? genre?.label)))
    .filter((genre: any): genre is string => typeof genre === "string" && Boolean(genre.trim()))
    .map((genre: string) => genre.trim());
}

function uniqueGenres(...groups: string[][]): string[] | undefined {
  const seen = new Set<string>();
  const genres: string[] = [];
  for (const group of groups) {
    for (const genre of group) {
      const key = genre.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      genres.push(genre);
    }
  }
  return genres.length > 0 ? genres : undefined;
}

function directArtistGenres(value: any): string[] {
  const genres: string[] = [];
  for (const artist of arrayItems(value)) {
    const data = artist?.data ?? artist;
    genres.push(...genreValues(data?.genres), ...genreValues(data?.profile?.genres));
  }
  return genres;
}

export function musicalKeyFromSpotifyAudioFeatures(
  features: Pick<SpotifyAudioFeatures, "key" | "mode"> | null | undefined,
): string | undefined {
  const key = firstFiniteNumber(features?.key);
  const mode = firstFiniteNumber(features?.mode);
  if (!Number.isInteger(key) || key === undefined || key < 0 || key > 11 || (mode !== 0 && mode !== 1)) {
    return undefined;
  }
  return (mode === 1 ? CAMELOT_MAJOR : CAMELOT_MINOR)[key];
}

export function discTotalFromAlbum(albumData: any): number | undefined {
  const explicit = positiveInteger(
    albumData?.discTotal,
    albumData?.disc_total,
    albumData?.discCount,
    albumData?.numberOfDiscs,
    albumData?.discs?.totalCount,
  );
  if (explicit) return explicit;

  const tracksContainer = albumData?.tracksV2 ?? albumData?.tracks;
  const items = arrayItems(tracksContainer);
  const totals = [tracksContainer?.totalCount, tracksContainer?.total, albumData?.total_tracks]
    .map((value) => positiveInteger(value))
    .filter((value): value is number => value !== undefined);
  const total = totals.length > 0 ? Math.max(...totals) : undefined;
  if (items.length === 0 || (total !== undefined && items.length < total)) return undefined;

  let maximum = 0;
  for (const item of items) {
    const track = item?.track?.data ?? item?.track ?? item;
    maximum = Math.max(maximum, positiveInteger(track?.discNumber, track?.disc_number, item?.discNumber) ?? 0);
  }
  return maximum > 0 ? maximum : undefined;
}

function graphqlAudioFeatures(trackData: any): any {
  return trackData?.audioFeatures ?? trackData?.audioFeaturesV2 ?? trackData?.audioMetadata ?? trackData?.audio;
}

function withOptionalMetadata(base: Track, metadata: Partial<Track>): Track {
  const result = { ...base };
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

export function transformGraphQLTrack(trackData: any, context: GraphQLTrackContext = {}): Track {
  const uri = trackData?.uri as string | undefined;
  const id = uri ? uriToId(uri) : String(trackData?.id ?? "");
  const albumData = context.albumData ?? trackData?.albumOfTrack ?? trackData?.album;
  const albumUri = albumData?.uri as string | undefined;
  const albumId = albumData?.id ?? (albumUri ? uriToId(albumUri) : (context.fallbackAlbumId ?? null));
  const durationMs =
    positiveNumber(
      trackData?.trackDuration?.totalMilliseconds,
      trackData?.duration?.totalMilliseconds,
      trackData?.duration_ms,
    ) ?? 0;
  const artists = artistRefs(trackData?.artists ?? trackData?.firstArtist);
  const albumArtists = artistRefs(albumData?.artists);
  const audioFeatures = graphqlAudioFeatures(trackData);
  const directKey = stringValue(trackData?.musicalKey, trackData?.musical_key, audioFeatures?.musicalKey);
  const genres = uniqueGenres(
    genreValues(trackData?.genres),
    genreValues(albumData?.genres),
    directArtistGenres(trackData?.artists),
    directArtistGenres(albumData?.artists),
  );
  const releaseYear = yearFrom(
    trackData?.releaseYear,
    trackData?.release_year,
    trackData?.releaseDate?.isoString,
    albumData?.date?.isoString,
    albumData?.date?.year,
    albumData?.releaseDate?.isoString,
    albumData?.release_date,
  );
  const trackNumber = positiveInteger(
    trackData?.trackNumber,
    trackData?.track_number,
    context.trackEntry?.trackNumber,
    context.trackEntry?.track_number,
  );
  const trackTotal = positiveInteger(
    context.trackTotal,
    trackData?.trackTotal,
    trackData?.track_total,
    albumData?.tracksV2?.totalCount,
    albumData?.tracks?.total,
    albumData?.total_tracks,
  );
  const discNumber = positiveInteger(
    trackData?.discNumber,
    trackData?.disc_number,
    context.trackEntry?.discNumber,
    context.trackEntry?.disc_number,
  );
  const discTotal =
    positiveInteger(context.discTotal, trackData?.discTotal, trackData?.disc_total) ?? discTotalFromAlbum(albumData);
  const bpm = positiveNumber(trackData?.bpm, trackData?.tempo, audioFeatures?.bpm, audioFeatures?.tempo);

  const base: Track = {
    id,
    provider: PROVIDER_ID,
    title: trackData?.name ?? trackData?.title ?? "",
    artists,
    album: albumData
      ? {
          id: typeof albumId === "string" && albumId ? albumId : null,
          name: albumData?.name ?? albumData?.title ?? "",
        }
      : null,
    duration: durationMs > 0 ? formatDurationMs(durationMs) : null,
    durationSeconds: durationMs > 0 ? Math.round(durationMs / 1000) : null,
    thumbnailURL: bestImageFromSources(imageSources(albumData)),
    isExplicit: trackData?.explicit === true || trackData?.contentRating?.label === "EXPLICIT",
  };

  return withOptionalMetadata(base, {
    genres,
    releaseYear,
    albumArtists: albumArtists.length > 0 ? albumArtists : undefined,
    trackNumber,
    trackTotal,
    discNumber,
    discTotal,
    bpm,
    musicalKey: directKey ?? musicalKeyFromSpotifyAudioFeatures(audioFeatures),
  });
}

function graphQLTrackCandidate(item: any): { data: any; fallbackUri?: string } | null {
  const candidates = [
    { data: item?.itemV2?.data, fallbackUri: item?.itemV2?._uri },
    { data: item?.track?.data, fallbackUri: item?.track?._uri },
    { data: item?.track, fallbackUri: item?.track?._uri },
    { data: item?.data, fallbackUri: item?._uri },
    { data: item, fallbackUri: item?._uri },
  ];
  for (const candidate of candidates) {
    if (!candidate.data) continue;
    const uri = candidate.data.uri ?? candidate.fallbackUri;
    if (typeof uri === "string" && uri.startsWith("spotify:track:")) {
      return { data: candidate.data, fallbackUri: uri };
    }
  }
  return null;
}

export function transformGraphQLTrackItem(item: any): Track | null {
  const candidate = graphQLTrackCandidate(item);
  if (!candidate) return null;
  const normalized = candidate.data.uri ? candidate.data : { ...candidate.data, uri: candidate.fallbackUri };
  return transformGraphQLTrack(normalized);
}

export function transformGraphQLAlbumTrack(trackEntry: any, albumData: any, fallbackAlbumId: string): Track | null {
  const rawTrack = trackEntry?.track?.data ?? trackEntry?.track ?? trackEntry;
  const uri = rawTrack?.uri ?? trackEntry?._uri;
  if (typeof uri !== "string" || !uri.startsWith("spotify:track:")) return null;

  const normalized = {
    ...rawTrack,
    uri,
    albumOfTrack: rawTrack?.albumOfTrack ?? {
      ...albumData,
      uri: albumData?.uri ?? `spotify:album:${fallbackAlbumId}`,
    },
  };
  return transformGraphQLTrack(normalized, {
    albumData,
    trackEntry,
    fallbackAlbumId,
    trackTotal: albumData?.tracksV2?.totalCount ?? albumData?.tracks?.total ?? albumData?.total_tracks,
    discTotal: discTotalFromAlbum(albumData),
  });
}

function spotifyArtistIds(trackData: any): string[] {
  const ids: string[] = [];
  for (const artist of [...arrayItems(trackData?.album?.artists), ...arrayItems(trackData?.artists)]) {
    const id = artist?.id ?? (artist?.uri ? uriToId(artist.uri) : null);
    if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function artistRefIds(artists: ArtistRef[] | null | undefined): string[] {
  return (artists ?? []).flatMap((artist) => (artist.id ? [artist.id] : []));
}

function albumTrackData(albumData: any, trackId: string): any {
  return arrayItems(albumData?.tracks).find((track: any) => track?.id === trackId) ?? null;
}

function fallbackSpotifyTrackData(track: Track, albumData: any): any {
  const albumTrack = albumTrackData(albumData, track.id);
  return {
    ...albumTrack,
    id: track.id,
    artists: albumTrack?.artists ?? track.artists,
    album: albumData ?? (track.album ? { ...track.album, artists: track.albumArtists ?? [] } : null),
  };
}

function genresFromArtists(ids: string[], artistsById: ReadonlyMap<string, any> | undefined): string[] {
  if (!artistsById) return [];
  const genres: string[] = [];
  for (const id of ids) {
    genres.push(...genreValues(artistsById.get(id)?.genres));
  }
  return genres;
}

export function enrichTrackFromSpotifyData(
  base: Track,
  trackData: SpotifyTrack | any,
  enrichment: SpotifyTrackEnrichment = {},
): Track {
  const albumData = enrichment.albumData ?? trackData?.album;
  const trackAlbumArtists = artistRefs(trackData?.album?.artists);
  const albumArtists = trackAlbumArtists.length > 0 ? trackAlbumArtists : artistRefs(albumData?.artists);
  const genres = uniqueGenres(
    base.genres ?? [],
    genreValues(trackData?.genres),
    genreValues(albumData?.genres),
    genresFromArtists(spotifyArtistIds(trackData), enrichment.artistsById),
  );

  return withOptionalMetadata(base, {
    genres,
    releaseYear: yearFrom(trackData?.album?.release_date, albumData?.release_date, base.releaseYear),
    albumArtists: albumArtists.length > 0 ? albumArtists : base.albumArtists,
    trackNumber: positiveInteger(trackData?.track_number, trackData?.trackNumber, base.trackNumber),
    trackTotal: positiveInteger(
      trackData?.album?.total_tracks,
      albumData?.total_tracks,
      albumData?.tracks?.total,
      base.trackTotal,
    ),
    discNumber: positiveInteger(trackData?.disc_number, trackData?.discNumber, base.discNumber),
    discTotal: discTotalFromAlbum(albumData) ?? positiveInteger(base.discTotal),
    bpm: positiveNumber(enrichment.audioFeatures?.tempo, base.bpm),
    musicalKey: musicalKeyFromSpotifyAudioFeatures(enrichment.audioFeatures) ?? base.musicalKey,
  });
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchSpotifyObjects(
  accessToken: string,
  path: string,
  responseKey: string,
  ids: string[],
  batchSize: number,
): Promise<any[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const batches = await Promise.all(
    chunks(uniqueIds, batchSize).map(async (batch) => {
      try {
        const response = await spotifyFetch(`${SPOTIFY_API}/${path}?ids=${encodeURIComponent(batch.join(","))}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        });
        if (!response.ok) return [];
        const data = (await response.json()) as Record<string, any>;
        const values = data[responseKey];
        return Array.isArray(values) ? values.filter(Boolean) : [];
      } catch {
        return [];
      }
    }),
  );
  return batches.flat();
}

function byId(values: any[]): Map<string, any> {
  const result = new Map<string, any>();
  for (const value of values) {
    if (typeof value?.id === "string" && value.id) result.set(value.id, value);
  }
  return result;
}

export async function enrichSpotifyTracks(spDc: string, tracks: Track[]): Promise<Track[]> {
  if (tracks.length === 0) return tracks;

  try {
    const accessToken = await getAccessToken(spDc);
    const ids = [...new Set(tracks.map((track) => track.id).filter(Boolean))];
    const [trackObjects, audioFeatures] = await Promise.all([
      fetchSpotifyObjects(accessToken, "tracks", "tracks", ids, 50),
      fetchSpotifyObjects(accessToken, "audio-features", "audio_features", ids, 100),
    ]);
    const tracksById = byId(trackObjects);
    const audioById = byId(audioFeatures);
    const albumIds = [
      ...trackObjects.map((track) => track?.album?.id),
      ...tracks.map((track) => track.album?.id),
    ].filter((id: any): id is string => typeof id === "string" && Boolean(id));
    const artistIds = [
      ...trackObjects.flatMap((track) => spotifyArtistIds(track)),
      ...tracks.flatMap((track) => [...artistRefIds(track.albumArtists), ...artistRefIds(track.artists)]),
    ];
    const [albumObjects, artistObjects] = await Promise.all([
      fetchSpotifyObjects(accessToken, "albums", "albums", albumIds, 20),
      fetchSpotifyObjects(accessToken, "artists", "artists", artistIds, 50),
    ]);
    const albumsById = byId(albumObjects);
    const artistsById = byId(artistObjects);

    return tracks.map((track) => {
      const webTrack = tracksById.get(track.id);
      const albumId = webTrack?.album?.id ?? track.album?.id;
      const albumData = albumsById.get(albumId);
      const trackData = webTrack ?? fallbackSpotifyTrackData(track, albumData);
      return enrichTrackFromSpotifyData(track, trackData, {
        audioFeatures: audioById.get(track.id),
        albumData,
        artistsById,
      });
    });
  } catch {
    return tracks;
  }
}

export async function enrichHomeSections(spDc: string, sections: HomeSection[]): Promise<HomeSection[]> {
  const tracks = sections.flatMap((section) =>
    section.items.flatMap((item) => (item.type === "track" ? [item.track] : [])),
  );
  const enriched = await enrichSpotifyTracks(spDc, tracks);
  let index = 0;
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => (item.type === "track" ? { ...item, track: enriched[index++]! } : item)),
  }));
}
