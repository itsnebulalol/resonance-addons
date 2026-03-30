const TPB_API = "https://apibay.org";

export interface TorrentResult {
  name: string;
  infoHash: string;
  seeders: number;
  leechers: number;
  size: number;
  magnetLink: string;
}

export function qualityScore(name: string): number {
  const lower = name.toLowerCase();
  let score = 0;
  if (/24[\s-]?bit/i.test(lower) || /hi[\s-]?res/i.test(lower) || /\b24[\s-]?(44|48|88|96|176|192)\b/.test(lower))
    score += 100;
  if (lower.includes("flac")) score += 80;
  if (lower.includes("alac")) score += 75;
  if (/wav\b/.test(lower)) score += 70;
  if (lower.includes("320k") || lower.includes("320 k") || lower.includes("320kbps")) score += 50;
  if (lower.includes("mp3") && !lower.includes("320")) score += 20;
  if (lower.includes("aac")) score += 30;
  return score;
}

function buildMagnet(hash: string, name: string): string {
  const trackers = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
  ];
  const tr = trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join("");
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${tr}`;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function searchTPBRaw(query: string): Promise<TorrentResult[]> {
  try {
    const res = await fetchWithTimeout(
      `${TPB_API}/q.php?q=${encodeURIComponent(query)}&cat=100,101,102,103,104,199`,
      3000,
    );
    if (!res.ok) return [];

    const data = (await res.json()) as any[];
    if (!data?.length) return [];

    return data
      .filter((r) => r.info_hash !== "0000000000000000000000000000000000000000")
      .filter((r) => parseInt(r.seeders, 10) > 0)
      .map((r) => ({
        name: r.name,
        infoHash: r.info_hash.toLowerCase(),
        seeders: parseInt(r.seeders, 10),
        leechers: parseInt(r.leechers, 10),
        size: parseInt(r.size, 10),
        magnetLink: buildMagnet(r.info_hash, r.name),
      }));
  } catch (e: any) {
    if (e.name === "AbortError") console.error("[tpb] Search timed out");
    else console.error("[tpb] Search error:", e.message);
    return [];
  }
}

const TCSV_API = "https://torrents-csv.com/service";

async function searchTCSVRaw(query: string): Promise<TorrentResult[]> {
  try {
    const res = await fetchWithTimeout(`${TCSV_API}/search?q=${encodeURIComponent(query)}&size=30`, 3000);
    if (!res.ok) return [];

    const data = (await res.json()) as any;
    const torrents = data?.torrents ?? [];

    return torrents
      .filter((r: any) => (r.seeders ?? 0) > 0)
      .map((r: any) => ({
        name: r.name,
        infoHash: r.infohash.toLowerCase(),
        seeders: r.seeders ?? 0,
        leechers: r.leechers ?? 0,
        size: r.size_bytes ?? 0,
        magnetLink: buildMagnet(r.infohash, r.name),
      }));
  } catch (e: any) {
    if (e.name === "AbortError") console.error("[tcsv] Search timed out");
    else console.error("[tcsv] Search error:", e.message);
    return [];
  }
}

export async function searchTPB(query: string): Promise<TorrentResult[]> {
  const [tpb, tcsv] = await Promise.all([searchTPBRaw(query), searchTCSVRaw(query)]);
  const seen = new Set<string>();
  const merged: TorrentResult[] = [];
  for (const r of [...tpb, ...tcsv]) {
    if (!seen.has(r.infoHash)) {
      seen.add(r.infoHash);
      merged.push(r);
    }
  }
  return merged;
}

export function rankResults(results: TorrentResult[]): TorrentResult[] {
  return [...results].sort((a, b) => {
    const qA = qualityScore(a.name);
    const qB = qualityScore(b.name);
    if (qA !== qB) return qB - qA;
    return b.seeders - a.seeders;
  });
}
