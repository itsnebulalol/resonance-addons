import { amFetch, isOnDeviceFetchSignal } from "../delegated-fetch";
import { getDeveloperToken, getUserToken } from "../token";
import { errorResponse, json } from "../utils";
import { searchSong } from "./search";

const API_BASE = "https://amp-api.music.apple.com";
const STOREFRONT = "us";

interface LyricsWord {
  id: number;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
}

interface LyricsLine {
  id: number;
  startTimeMs: number;
  endTimeMs: number | null;
  text: string;
  words: LyricsWord[];
  backgroundText: string | null;
  backgroundWords: LyricsWord[];
}

interface LyricsData {
  syncType: "wordSynced" | "lineSynced" | "unsynced";
  lines: LyricsLine[];
}

export async function handleLyrics(title?: string, artist?: string, _videoId?: string): Promise<Response> {
  try {
    if (!title && !artist) {
      return json(null);
    }

    const result = await searchSong(title ?? "", artist ?? "");
    if (!result) {
      console.log(`[lyrics] No search result for "${title}" — "${artist}"`);
      return json(null);
    }
    console.log(`[lyrics] Resolved "${title}" — "${artist}" → songId=${result.songId}`);

    const lyrics = await fetchLyrics(result.songId);
    return json(lyrics);
  } catch (e: any) {
    if (isOnDeviceFetchSignal(e)) {
      throw e;
    }
    console.error("[lyrics] Error:", e.message);
    return errorResponse(e.message, 500);
  }
}

async function fetchLyrics(songId: string): Promise<LyricsData | null> {
  const syllable = await fetchTTML(songId, "syllable-lyrics");
  if (syllable) return syllable;

  const line = await fetchTTML(songId, "lyrics");
  if (line) return line;

  return null;
}

async function fetchTTML(songId: string, endpoint: string): Promise<LyricsData | null> {
  const token = await getDeveloperToken();
  const url = `${API_BASE}/v1/catalog/${STOREFRONT}/songs/${songId}/${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Origin: "https://music.apple.com",
    Referer: "https://music.apple.com/",
    Accept: "application/json",
  };
  const userToken = getUserToken();
  if (userToken) {
    headers["media-user-token"] = userToken;
  }
  console.log(`[lyrics] ${endpoint}: songId=${songId} userToken=${userToken ? "yes" : "MISSING"}`);

  const res = await amFetch(url, { headers });

  if (!res.ok) {
    const body = await res.text();
    console.log(`[lyrics] ${endpoint}: HTTP ${res.status} — ${body.slice(0, 200)}`);
    return null;
  }

  const data = (await res.json()) as any;
  const ttml = data?.data?.[0]?.attributes?.ttml as string | undefined;
  if (!ttml) return null;

  console.log(`[lyrics] ${endpoint}: got TTML (${ttml.length} chars)`);
  return parseTTML(ttml);
}

function parseTTML(ttml: string): LyricsData | null {
  const isWordSynced = ttml.includes('itunes:timing="Word"') || ttml.includes("itunes:timing='Word'");

  const lines: LyricsLine[] = [];
  const pRe = /<p\s[^>]*begin="([^"]*)"[^>]*?(?:end="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/g;
  let pMatch: RegExpExecArray | null;
  let lineId = 0;

  while ((pMatch = pRe.exec(ttml)) !== null) {
    const pBegin = parseTimestamp(pMatch[1]!);
    const pEnd = pMatch[2] ? parseTimestamp(pMatch[2]) : null;
    const pBody = pMatch[3]!;

    const { mainText, mainWords, bgText, bgWords } = parseLineBody(pBody);

    if (!mainText) continue;

    const words: LyricsWord[] = mainWords.map((w, i) => ({
      id: i,
      startTimeMs: w.startTimeMs,
      endTimeMs: w.endTimeMs,
      text: w.text,
    }));

    const backgroundWords: LyricsWord[] = bgWords.map((w, i) => ({
      id: i,
      startTimeMs: w.startTimeMs,
      endTimeMs: w.endTimeMs,
      text: w.text,
    }));

    lines.push({
      id: lineId++,
      startTimeMs: pBegin,
      endTimeMs: pEnd,
      text: mainText,
      words,
      backgroundText: bgText || null,
      backgroundWords,
    });
  }

  if (!lines.length) return null;

  return {
    syncType: isWordSynced ? "wordSynced" : "lineSynced",
    lines,
  };
}

interface RawWord {
  text: string;
  startTimeMs: number;
  endTimeMs: number;
}

function parseLineBody(body: string): {
  mainText: string;
  mainWords: RawWord[];
  bgText: string;
  bgWords: RawWord[];
} {
  let mainText = "";
  const mainWords: RawWord[] = [];
  let bgText = "";
  const bgWords: RawWord[] = [];

  const bgRe = /<span[^>]*ttm:role="[^"]*"[^>]*>([\s\S]*?)<\/span>/;
  const bgMatch = bgRe.exec(body);

  let mainBody = body;
  if (bgMatch) {
    mainBody = body.slice(0, bgMatch.index) + body.slice(bgMatch.index! + bgMatch[0].length);
    const bgBody = bgMatch[1]!;
    const bgSpanWords = parseSpans(bgBody);
    bgText = bgSpanWords
      .map((w) => w.text)
      .join("")
      .trim();
    bgWords.push(...bgSpanWords);
  }

  const spanWords = parseSpans(mainBody);
  if (spanWords.length) {
    mainText = spanWords
      .map((w) => w.text)
      .join("")
      .trim();
    mainWords.push(...spanWords);
  } else {
    mainText = stripTags(mainBody).trim();
  }

  return { mainText, mainWords, bgText, bgWords };
}

function parseSpans(body: string): RawWord[] {
  const words: RawWord[] = [];
  const spanRe = /<span[^>]*begin="([^"]*)"[^>]*end="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = spanRe.exec(body)) !== null) {
    const text = stripTags(m[3]!);
    if (!text) continue;
    words.push({
      text,
      startTimeMs: parseTimestamp(m[1]!),
      endTimeMs: parseTimestamp(m[2]!),
    });
  }
  return words;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(":");
  if (parts.length === 3) {
    const h = parseFloat(parts[0]!);
    const m = parseFloat(parts[1]!);
    const s = parseFloat(parts[2]!);
    return Math.round((h * 3600 + m * 60 + s) * 1000);
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]!);
    const s = parseFloat(parts[1]!);
    return Math.round((m * 60 + s) * 1000);
  }
  return Math.round(parseFloat(ts) * 1000);
}
