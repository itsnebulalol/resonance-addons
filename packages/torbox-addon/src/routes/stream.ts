import { AddonError } from "@resonance-addons/sdk";
import type { TorrentResult } from "../search-torrents";
import { qualityScore, rankResults, searchTPB } from "../search-torrents";
import type { TorrentFile } from "../torbox";
import { checkCached, createTorrent, resolveHashToDownload } from "../torbox";

const AUDIO_MIMES = new Set([
  "audio/flac",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/x-wav",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/x-ape",
]);

function isAudioFile(f: { mimetype?: string; short_name?: string; name?: string }): boolean {
  if (f.mimetype && AUDIO_MIMES.has(f.mimetype)) return true;
  const name = (f.short_name ?? f.name ?? "").toLowerCase();
  return /\.(flac|mp3|m4a|aac|ogg|opus|wav|alac|ape)$/i.test(name);
}

const FORMAT_PRIORITY: Record<string, number> = {
  flac: 100,
  alac: 90,
  wav: 80,
  m4a: 60,
  aac: 50,
  ogg: 40,
  opus: 40,
  mp3: 30,
  ape: 70,
};

function fileFormatScore(f: { short_name?: string; name?: string }): number {
  const ext = (f.short_name ?? f.name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return FORMAT_PRIORITY[ext] ?? 0;
}

function avgAudioFileSize(
  files: Array<{ size?: number; short_name?: string; name?: string; mimetype?: string }>,
): number {
  const audio = files.filter((f) => isAudioFile(f as any));
  if (!audio.length) return 0;
  return audio.reduce((sum, f) => sum + (f.size ?? 0), 0) / audio.length;
}

function matchTrackInFiles(files: TorrentFile[], title: string): TorrentFile | null {
  const audioFiles = files.filter((f) => isAudioFile(f));
  if (!audioFiles.length) return null;

  const titleLower = title.toLowerCase().replace(/[^\w\s]/g, "");
  const titleWords = titleLower.split(/\s+/).filter((w) => w.length > 1);
  const totalWords = titleWords.length || 1;

  let bestMatch: TorrentFile | null = null;
  let bestScore = -1;
  let bestFormat = -1;
  let bestSize = -1;

  for (const f of audioFiles) {
    const nameLower = (f.short_name ?? f.name).toLowerCase().replace(/[^\w\s]/g, "");
    let matched = 0;
    for (const word of titleWords) {
      if (nameLower.includes(word)) matched++;
    }
    const minRequired = Math.max(1, Math.ceil(totalWords * 0.5));
    if (matched < minRequired) continue;

    const score = matched / totalWords;
    const fmt = fileFormatScore(f);
    const size = f.size ?? 0;

    if (
      score > bestScore ||
      (score === bestScore && fmt > bestFormat) ||
      (score === bestScore && fmt === bestFormat && size > bestSize)
    ) {
      bestScore = score;
      bestFormat = fmt;
      bestSize = size;
      bestMatch = f;
    }
  }

  return bestMatch;
}

function stripFeatTags(s: string): string {
  return s
    .replace(/\s*[([](feat\.?|ft\.?|prod\.?|with)\s+[^)\]]*[)\]]/gi, "")
    .replace(/\s*-\s*(feat\.?|ft\.?)\s+.*/gi, "")
    .replace(/["""''`]/g, "")
    .trim();
}

function buildMagnetFromHash(hash: string): string {
  const trackers = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://open.stealth.si:80/announce",
  ];
  return `magnet:?xt=urn:btih:${hash}${trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join("")}`;
}

function getFormatInfo(file: TorrentFile): { format: string; bitrate: number | null } {
  const ext = (file.short_name ?? file.name).split(".").pop()?.toLowerCase() ?? "flac";
  const mimeMap: Record<string, string> = {
    flac: "audio/flac",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    opus: "audio/opus",
    wav: "audio/wav",
  };
  return {
    format: mimeMap[ext] ?? "audio/flac",
    bitrate: ext === "flac" ? 1411 : ext === "mp3" ? 320 : null,
  };
}

function pickBestForTrack(results: TorrentResult[], title: string): TorrentResult {
  const titleLower = title.toLowerCase();
  const withTitle = results.filter((r) => r.name.toLowerCase().includes(titleLower));
  if (withTitle.length) return withTitle[0]!;
  return results[0]!;
}

export async function handleStream(
  apiKey: string,
  trackId: string,
  allowUncached: boolean = false,
): Promise<{ url: string; bitrate: number | null; durationSeconds: number | null; format: string }> {
  try {
    const decoded = decodeURIComponent(trackId);
    const parts = decoded.includes("--") ? decoded.split("--") : decoded.split("::");
    const title = parts[0] ?? "";
    const artist = parts[1] ?? "";
    const album = parts[2] ?? "";

    if (!title || !artist) {
      throw new AddonError("Track ID must be in format title--artist", 400);
    }

    const cleanTitle = stripFeatTags(title);
    console.log(`[stream] Resolving: ${artist} - ${cleanTitle}${album ? ` (${album})` : ""}`);

    const queries = [`${artist} ${album || cleanTitle} FLAC`, `${artist} ${album || cleanTitle}`, `${artist} FLAC`];
    if (album && album !== cleanTitle) {
      queries.push(`${artist} ${cleanTitle} FLAC`);
    }

    const t0 = Date.now();
    const searchResults = await Promise.all(queries.map((q) => searchTPB(q)));
    const allResults = rankResults(
      searchResults.flat().filter((r, i, arr) => arr.findIndex((x) => x.infoHash === r.infoHash) === i),
    );

    if (!allResults.length) {
      throw new AddonError("No torrents found", 404);
    }

    console.log(`[stream] ${allResults.length} unique torrents in ${Date.now() - t0}ms, checking cache...`);

    const hashes = allResults.slice(0, 50).map((r) => r.infoHash);
    const cached = await checkCached(apiKey, hashes);

    if (!cached.length) {
      if (allowUncached && allResults.length > 0) {
        const best = pickBestForTrack(allResults, cleanTitle);
        console.log(`[stream] No cache hit, queuing: ${best.name} (${best.seeders} seeds)`);
        createTorrent(apiKey, best.magnetLink).catch(() => {});
      }
      throw new AddonError("No cached torrents found", 404);
    }

    const albumLower = album.toLowerCase().replace(/[^\w\s]/g, "");
    const albumWords = albumLower.split(/\s+/).filter((w) => w.length > 2);

    function albumRelevance(name: string): number {
      if (!albumWords.length) return 0;
      const nameLower = name.toLowerCase().replace(/[^\w\s]/g, "");
      const matched = albumWords.filter((w) => nameLower.includes(w)).length;
      return matched / albumWords.length;
    }

    const sortedCached = cached
      .filter((t) => (t.files ?? []).some((f) => isAudioFile(f)))
      .sort((a, b) => {
        const relA = albumRelevance(a.name);
        const relB = albumRelevance(b.name);
        if (relA !== relB) return relB - relA;
        const qDiff = qualityScore(b.name) - qualityScore(a.name);
        if (qDiff !== 0) return qDiff;
        const avgA = avgAudioFileSize(a.files ?? []);
        const avgB = avgAudioFileSize(b.files ?? []);
        return avgB - avgA;
      });

    console.log(`[stream] ${sortedCached.length} cached with audio, resolving...`);

    const titleLower = cleanTitle.toLowerCase().replace(/[^\w\s]/g, "");
    const titleWords = titleLower.split(/\s+/).filter((w) => w.length > 1);
    const minWords = Math.max(1, Math.ceil(titleWords.length * 0.5));

    const preFiltered = sortedCached.filter((torrent) => {
      const audioFiles = (torrent.files ?? []).filter((f) => isAudioFile(f));
      return audioFiles.some((f) => {
        const nameLower = (f.short_name ?? f.name).toLowerCase().replace(/[^\w\s]/g, "");
        const matched = titleWords.filter((w) => nameLower.includes(w)).length;
        return matched >= minWords;
      });
    });

    console.log(`[stream] ${preFiltered.length} pass pre-filter for "${cleanTitle}"`);

    const candidates = preFiltered.length > 0 ? preFiltered : sortedCached.slice(0, 3);

    let createTorrentUsed = false;
    for (const torrent of candidates) {
      const magnet =
        allResults.find((r) => r.infoHash === torrent.hash)?.magnetLink ?? buildMagnetFromHash(torrent.hash);

      const result = await resolveHashToDownload(
        apiKey,
        torrent.hash,
        magnet,
        (files) => matchTrackInFiles(files, cleanTitle),
        createTorrentUsed,
      );

      if (result?.usedCreate) createTorrentUsed = true;

      if (result?.url) {
        const { format, bitrate } = getFormatInfo(result.file);
        console.log(`[stream] Resolved: ${torrent.name} → ${result.file.short_name} in ${Date.now() - t0}ms`);

        return {
          url: result.url,
          bitrate,
          durationSeconds: null,
          format,
        };
      }
    }

    if (allowUncached && allResults.length > 0) {
      const best = pickBestForTrack(allResults, cleanTitle);
      console.log(`[stream] No match in cache, queuing: ${best.name} (${best.seeders} seeds)`);
      createTorrent(apiKey, best.magnetLink).catch(() => {});
    }

    throw new AddonError("No cached torrents with matching audio found", 404);
  } catch (e: any) {
    if (e instanceof AddonError) {
      throw e;
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error("[stream] Error:", message);
    throw new AddonError(message, 500);
  }
}
