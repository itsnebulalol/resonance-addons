import { AddonError } from "@resonance-addons/sdk";
import { amFetch } from "../cached-fetch";
import { getDeveloperToken, getUserToken } from "../token";
import { searchSong } from "./search";

const API_BASE = "https://amp-api.music.apple.com";
const STOREFRONT = "us";

interface LyricsWord {
  id: number;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  startsNewWord: boolean;
}

interface LyricsLine {
  id: number;
  startTimeMs: number;
  endTimeMs: number | null;
  text: string;
  words: LyricsWord[];
  backgroundText: string | null;
  backgroundWords: LyricsWord[];
  agent: string | null;
}

interface LyricsData {
  syncType: "wordSynced" | "lineSynced" | "unsynced";
  lines: LyricsLine[];
}

export async function handleLyrics(title?: string, artist?: string, _videoId?: string): Promise<LyricsData | null> {
  try {
    if (!title && !artist) {
      return null;
    }

    const result = await searchSong(title ?? "", artist ?? "");
    if (!result) {
      console.log(`[lyrics] No search result for "${title}" — "${artist}"`);
      return null;
    }
    console.log(`[lyrics] Resolved "${title}" — "${artist}" → songId=${result.songId}`);

    const lyrics = await fetchLyrics(result.songId);
    return lyrics;
  } catch (e: any) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[lyrics] Error:", message);
    throw new AddonError(message, 500);
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
  const pRe = /<p\s([^>]*)>([\s\S]*?)<\/p>/g;
  let pMatch: RegExpExecArray | null;
  let lineId = 0;

  while ((pMatch = pRe.exec(ttml)) !== null) {
    const attrs = pMatch[1]!;
    const pBody = pMatch[2]!;

    const beginMatch = attrs.match(/begin="([^"]*)"/);
    const endMatch = attrs.match(/end="([^"]*)"/);
    const agentMatch = attrs.match(/ttm:agent="([^"]*)"/);

    if (!beginMatch) continue;

    const pBegin = parseTimestamp(beginMatch[1]!);
    const pEnd = endMatch ? parseTimestamp(endMatch[1]!) : null;
    const agent = agentMatch ? agentMatch[1]! : null;

    const { mainText, mainWords, bgText, bgWords } = parseLineBody(pBody);

    if (!mainText) continue;

    const words: LyricsWord[] = mainWords.map((w, i) => ({
      id: i,
      startTimeMs: w.startTimeMs,
      endTimeMs: w.endTimeMs,
      text: w.text,
      startsNewWord: w.startsNewWord,
    }));

    const backgroundWords: LyricsWord[] = bgWords.map((w, i) => ({
      id: i,
      startTimeMs: w.startTimeMs,
      endTimeMs: w.endTimeMs,
      text: w.text,
      startsNewWord: w.startsNewWord,
    }));

    lines.push({
      id: lineId++,
      startTimeMs: pBegin,
      endTimeMs: pEnd,
      text: mainText,
      words,
      backgroundText: bgText || null,
      backgroundWords,
      agent,
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
  startsNewWord: boolean;
}

/**
 * Extract the content of a <span ttm:role="..."> wrapper, handling nested spans
 * correctly by counting open/close tags instead of relying on lazy regex.
 */
function extractBgSpan(body: string): { bgContent: string; remaining: string } | null {
  const openRe = /<span[^>]*ttm:role="[^"]*"[^>]*>/;
  const openMatch = openRe.exec(body);
  if (!openMatch) return null;

  let depth = 1;
  let pos = openMatch.index + openMatch[0].length;
  const contentStart = pos;

  while (pos < body.length && depth > 0) {
    const nextOpen = body.indexOf("<span", pos);
    const nextClose = body.indexOf("</span>", pos);

    if (nextClose === -1) break;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = body.indexOf(">", nextOpen) + 1;
    } else {
      depth--;
      if (depth === 0) {
        const bgContent = body.slice(contentStart, nextClose);
        const fullMatchEnd = nextClose + "</span>".length;
        const remaining = body.slice(0, openMatch.index) + body.slice(fullMatchEnd);
        return { bgContent, remaining };
      }
      pos = nextClose + "</span>".length;
    }
  }

  return null;
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

  const bgResult = extractBgSpan(body);

  let mainBody = body;
  if (bgResult) {
    mainBody = bgResult.remaining;
    const bgSpanWords = parseSpans(bgResult.bgContent);
    bgText = wordsToText(bgSpanWords);
    bgWords.push(...bgSpanWords);
  }

  const spanWords = parseSpans(mainBody);
  if (spanWords.length) {
    mainText = wordsToText(spanWords);
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
  let lastMatchEnd = 0;
  while ((m = spanRe.exec(body)) !== null) {
    const text = stripTags(m[3]!);
    if (!text) continue;
    const gapBetween = body.slice(lastMatchEnd, m.index);
    const startsNewWord = words.length === 0 || /\s/.test(gapBetween);
    words.push({
      text,
      startTimeMs: parseTimestamp(m[1]!),
      endTimeMs: parseTimestamp(m[2]!),
      startsNewWord,
    });
    lastMatchEnd = m.index + m[0].length;
  }
  return words;
}

function wordsToText(words: RawWord[]): string {
  return words
    .map((w, i) => (i > 0 && w.startsNewWord ? " " : "") + w.text)
    .join("")
    .trim();
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
