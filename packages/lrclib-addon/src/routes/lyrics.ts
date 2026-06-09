import { AddonError } from "@resonance-addons/sdk";

const API_BASE = "https://lrclib.net/api";

interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration?: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

interface LyricsWord {
  id: number;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  startsNewWord?: boolean;
}

interface LyricsLine {
  id: number;
  startTimeMs: number;
  endTimeMs: number | null;
  text: string;
  words: LyricsWord[];
}

interface LyricsData {
  syncType: "lineSynced" | "unsynced";
  lines: LyricsLine[];
}

export async function handleLyrics(title?: string, artist?: string, _videoId?: string): Promise<LyricsData | null> {
  try {
    const normalizedTitle = title?.trim();
    const normalizedArtist = artist?.trim();

    if (!normalizedTitle) return null;

    const records = await searchLyrics(normalizedTitle, normalizedArtist);
    const match = pickBestMatch(records, normalizedTitle, normalizedArtist);
    if (!match) return null;

    return mapRecordToLyrics(match);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[lrclib:lyrics] Error:", message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(message, 500);
  }
}

async function searchLyrics(title: string, artist?: string): Promise<LrclibRecord[]> {
  const params = new URLSearchParams();

  params.set("track_name", title);
  if (artist) {
    params.set("artist_name", artist);
  }

  const response = await fetch(`${API_BASE}/search?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new AddonError(`LRCLIB search failed with HTTP ${response.status}`, response.status);
  }

  const data = await response.json();
  return Array.isArray(data) ? data.filter(isUsableRecord) : [];
}

function isUsableRecord(record: unknown): record is LrclibRecord {
  if (!record || typeof record !== "object") return false;
  const candidate = record as Partial<LrclibRecord>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.trackName === "string" &&
    typeof candidate.artistName === "string" &&
    typeof candidate.instrumental === "boolean" &&
    (typeof candidate.syncedLyrics === "string" || typeof candidate.plainLyrics === "string" || candidate.instrumental)
  );
}

function pickBestMatch(records: LrclibRecord[], title?: string, artist?: string): LrclibRecord | null {
  const scored = records
    .filter((record) => Boolean(record.syncedLyrics || record.plainLyrics) || record.instrumental)
    .map((record) => ({ record, score: scoreRecord(record, title, artist) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(Boolean(b.record.syncedLyrics)) - Number(Boolean(a.record.syncedLyrics));
    });

  return scored[0]?.record ?? null;
}

function scoreRecord(record: LrclibRecord, title?: string, artist?: string): number {
  let score = 0;
  const requestedTitle = normalizeForMatch(title);
  const requestedArtist = normalizeForMatch(artist);
  const recordTitle = normalizeForMatch(record.trackName);
  const recordArtist = normalizeForMatch(record.artistName);

  if (requestedTitle && recordTitle === requestedTitle) score += 80;
  else if (requestedTitle && (recordTitle.includes(requestedTitle) || requestedTitle.includes(recordTitle)))
    score += 40;

  if (requestedArtist && recordArtist === requestedArtist) score += 60;
  else if (requestedArtist && (recordArtist.includes(requestedArtist) || requestedArtist.includes(recordArtist))) {
    score += 30;
  }

  if (record.syncedLyrics) score += 10;
  if (record.plainLyrics) score += 5;
  if (record.instrumental) score += 5;
  score += Math.min(countLyricLines(record), 20);

  return score;
}

function countLyricLines(record: LrclibRecord): number {
  const lyrics = record.syncedLyrics || record.plainLyrics || "";
  return lyrics.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function mapRecordToLyrics(record: LrclibRecord): LyricsData | null {
  if (record.syncedLyrics?.trim()) {
    const synced = parseSyncedLyrics(record.syncedLyrics);
    if (synced) return synced;
  }

  if (record.plainLyrics?.trim()) {
    const lines = record.plainLyrics
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map<LyricsLine>((line, index) => ({
        id: index,
        startTimeMs: 0,
        endTimeMs: null,
        text: line,
        words: [],
      }));

    return lines.length ? { syncType: "unsynced", lines } : null;
  }

  if (record.instrumental) {
    return { syncType: "unsynced", lines: [] };
  }

  return null;
}

export function parseSyncedLyrics(lrc: string): LyricsData | null {
  const timestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const lines: LyricsLine[] = [];

  for (const rawLine of lrc.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(timestampPattern)];
    if (!matches.length) continue;

    const text = rawLine.replace(timestampPattern, "").trim();
    if (!text) continue;

    for (const match of matches) {
      const startTimeMs = parseTimestamp(match);
      lines.push({
        id: lines.length,
        startTimeMs,
        endTimeMs: null,
        text,
        words: [],
      });
    }
  }

  lines.sort((a, b) => a.startTimeMs - b.startTimeMs);
  for (let index = 0; index < lines.length; index++) {
    const current = lines[index];
    if (!current) continue;

    current.id = index;
    current.endTimeMs = lines[index + 1]?.startTimeMs ?? null;
  }

  return lines.length ? { syncType: "lineSynced", lines } : null;
}

function parseTimestamp(match: RegExpMatchArray): number {
  const minutes = Number.parseInt(match[1] ?? "0", 10);
  const seconds = Number.parseInt(match[2] ?? "0", 10);
  const fraction = match[3] ?? "0";
  const milliseconds = Number.parseInt(fraction.padEnd(3, "0").slice(0, 3), 10);

  return minutes * 60_000 + seconds * 1000 + milliseconds;
}

function normalizeForMatch(value?: string): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
