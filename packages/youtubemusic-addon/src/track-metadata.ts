import type { ArtistRef, Track } from "./types";

export type EnrichedTrackMetadata = Partial<
  Pick<
    Track,
    | "genres"
    | "releaseYear"
    | "albumArtists"
    | "trackNumber"
    | "trackTotal"
    | "discNumber"
    | "discTotal"
    | "bpm"
    | "musicalKey"
  >
>;

const METADATA_CONTAINERS = ["trackMetadata", "musicTrackMetadata", "songMetadata", "metadata"] as const;

function candidates(source: any): any[] {
  if (!source || typeof source !== "object") return [];
  return [...METADATA_CONTAINERS.map((key) => source[key]).filter(Boolean), source];
}

function firstValue(sources: any[], keys: string[]): unknown {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      if (source[key] != null) return source[key];
    }
  }
  return undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function releaseYear(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1000 && value <= 9999 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const match = value.match(/\b(\d{4})\b/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return parsed >= 1000 && parsed <= 9999 ? parsed : undefined;
}

function stringList(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\s*(?:,|;| • )\s*/) : [];
  const parsed = values
    .map((item) => (typeof item === "string" ? item : item?.name))
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return parsed.length > 0 ? parsed : undefined;
}

function artistRef(value: any): ArtistRef | null {
  if (typeof value === "string") {
    const name = value.trim();
    return name ? { id: null, name } : null;
  }
  if (!value || typeof value !== "object") return null;
  const name = String(value.name ?? value.title ?? value.text ?? "").trim();
  if (!name) return null;
  const id =
    value.id ??
    value.artistId ??
    value.browseId ??
    value.navigationEndpoint?.browseEndpoint?.browseId ??
    value.onTap?.innertubeCommand?.browseEndpoint?.browseId ??
    null;
  return { id: typeof id === "string" && id.length > 0 ? id : null, name };
}

function artistRefs(value: unknown): ArtistRef[] | undefined {
  if (typeof value === "string") {
    const refs = value
      .split(/\s*(?:,| • )\s*/)
      .map(artistRef)
      .filter((artist): artist is ArtistRef => artist != null);
    return refs.length > 0 ? refs : undefined;
  }

  const rawItems: any[] = Array.isArray(value)
    ? value
    : Array.isArray((value as any)?.items)
      ? (value as any).items
      : Array.isArray((value as any)?.runs)
        ? (value as any).runs.filter((run: any) => !/^(?:\s*[,&]\s*|\s*•\s*)$/.test(run?.text ?? ""))
        : [];
  const refs = rawItems.map(artistRef).filter((artist): artist is ArtistRef => artist != null);
  return refs.length > 0 ? refs : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = value.trim();
  return parsed.length > 0 ? parsed : undefined;
}

export function parseTrackMetadata(source: any, inherited: EnrichedTrackMetadata = {}): EnrichedTrackMetadata {
  const sources = candidates(source);
  const parsed: EnrichedTrackMetadata = { ...inherited };

  const genres = stringList(firstValue(sources, ["genres", "genreNames", "genre"]));
  const year = releaseYear(firstValue(sources, ["releaseYear", "releaseDate", "year"]));
  const albumArtists = artistRefs(firstValue(sources, ["albumArtists", "albumArtist"]));
  const trackNumber = positiveInteger(firstValue(sources, ["trackNumber", "track_number"]));
  const trackTotal = positiveInteger(
    firstValue(sources, ["trackTotal", "totalTracks", "totalTrackCount", "track_total"]),
  );
  const discNumber = positiveInteger(firstValue(sources, ["discNumber", "disc_number"]));
  const discTotal = positiveInteger(firstValue(sources, ["discTotal", "totalDiscs", "totalDiscCount", "disc_total"]));
  const bpm = positiveNumber(firstValue(sources, ["bpm", "beatsPerMinute"]));
  const musicalKey = nonEmptyString(firstValue(sources, ["musicalKey", "keySignature"]));

  if (genres) parsed.genres = genres;
  if (year) parsed.releaseYear = year;
  if (albumArtists) parsed.albumArtists = albumArtists;
  if (trackNumber) parsed.trackNumber = trackNumber;
  if (trackTotal) parsed.trackTotal = trackTotal;
  if (discNumber) parsed.discNumber = discNumber;
  if (discTotal) parsed.discTotal = discTotal;
  if (bpm) parsed.bpm = bpm;
  if (musicalKey) parsed.musicalKey = musicalKey;

  return parsed;
}

export function fillMissingTrackMetadata(track: Track, fallback: Track): void {
  const keys: (keyof EnrichedTrackMetadata)[] = [
    "genres",
    "releaseYear",
    "albumArtists",
    "trackNumber",
    "trackTotal",
    "discNumber",
    "discTotal",
    "bpm",
    "musicalKey",
  ];
  for (const key of keys) {
    if (track[key] == null && fallback[key] != null) {
      Object.assign(track, { [key]: fallback[key] });
    }
  }
}
