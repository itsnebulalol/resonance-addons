const TB_BASE = "https://api.torbox.app/v1/api";
const TIMEOUT = 8000;

const mylistCache = new Map<string, { list: TorrentInfo[]; ts: number }>();
const MYLIST_TTL = 60_000; // 1 minute

const dlUrlCache = new Map<string, { url: string; ts: number }>();
const DL_URL_TTL = 50 * 60_000; // 50 minutes
const DL_URL_MAX = 200;

function headers(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

async function tbFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface CachedTorrent {
  name: string;
  size: number;
  hash: string;
  files?: CachedFile[];
}

export interface CachedFile {
  name: string;
  size: number;
  short_name: string;
  mimetype: string;
}

export interface CreatedTorrent {
  hash: string;
  torrent_id: number;
  auth_id: string;
}

export interface TorrentInfo {
  id: number;
  name: string;
  hash: string;
  download_state: string;
  download_finished: boolean;
  download_present: boolean;
  files: TorrentFile[];
}

export interface TorrentFile {
  id: number;
  name: string;
  size: number;
  short_name: string;
  mimetype: string;
}

export async function checkCached(apiKey: string, hashes: string[]): Promise<CachedTorrent[]> {
  if (!hashes.length) return [];

  const hashStr = hashes.join(",");
  const res = await tbFetch(`${TB_BASE}/torrents/checkcached?hash=${hashStr}&format=list&list_files=true`, {
    headers: headers(apiKey),
  });

  const data = (await res.json()) as any;
  if (!data.success) return [];
  if (!Array.isArray(data.data)) return [];
  return data.data as CachedTorrent[];
}

export async function findTorrentByHash(apiKey: string, hash: string): Promise<TorrentInfo | null> {
  const cached = mylistCache.get(apiKey);
  if (cached && Date.now() - cached.ts < MYLIST_TTL) {
    const found = cached.list.find((t) => t.hash?.toLowerCase() === hash.toLowerCase());
    if (found) return found;
  }

  const res = await tbFetch(`${TB_BASE}/torrents/mylist?bypass_cache=true`, {
    headers: headers(apiKey),
  });

  const data = (await res.json()) as any;
  if (!data.success) return null;

  const list = (Array.isArray(data.data) ? data.data : []) as TorrentInfo[];
  mylistCache.set(apiKey, { list, ts: Date.now() });

  return list.find((t) => t.hash?.toLowerCase() === hash.toLowerCase()) ?? null;
}

function invalidateMylist(apiKey: string) {
  mylistCache.delete(apiKey);
}

export async function createTorrent(apiKey: string, magnetLink: string): Promise<CreatedTorrent | null> {
  const form = new FormData();
  form.append("magnet", magnetLink);
  form.append("seed", "1");
  form.append("allow_zip", "false");

  const res = await tbFetch(`${TB_BASE}/torrents/createtorrent`, {
    method: "POST",
    headers: headers(apiKey),
    body: form,
  });

  const data = (await res.json()) as any;
  if (!data.success) {
    console.error("[torbox] createtorrent failed:", data.detail);
    return null;
  }

  invalidateMylist(apiKey);

  return data.data as CreatedTorrent;
}

export async function getTorrentInfo(apiKey: string, torrentId: number): Promise<TorrentInfo | null> {
  const res = await tbFetch(`${TB_BASE}/torrents/mylist?id=${torrentId}`, {
    headers: headers(apiKey),
  });

  const data = (await res.json()) as any;
  if (!data.success) return null;
  return data.data as TorrentInfo;
}

export async function requestDownload(apiKey: string, torrentId: number, fileId: number): Promise<string | null> {
  const cacheKey = `${apiKey}:${torrentId}:${fileId}`;
  const cached = dlUrlCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < DL_URL_TTL) {
    return cached.url;
  }

  const res = await tbFetch(`${TB_BASE}/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}&file_id=${fileId}`, {
    headers: headers(apiKey),
  });

  const data = (await res.json()) as any;
  if (!data.success) {
    console.error("[torbox] requestdl failed:", data.detail);
    return null;
  }

  const url = data.data as string;

  if (dlUrlCache.size >= DL_URL_MAX) {
    const oldest = dlUrlCache.keys().next().value;
    if (oldest) dlUrlCache.delete(oldest);
  }
  dlUrlCache.set(cacheKey, { url, ts: Date.now() });

  return url;
}

export async function resolveHashToDownload(
  apiKey: string,
  hash: string,
  magnetLink: string,
  fileMatchFn: (files: TorrentFile[]) => TorrentFile | null,
  skipCreate: boolean = false,
): Promise<
  | { url: string; file: TorrentFile; usedCreate: boolean }
  | { url?: undefined; file?: undefined; usedCreate: boolean }
  | null
> {
  let torrentInfo = await findTorrentByHash(apiKey, hash);

  if (torrentInfo && torrentInfo.download_finished !== false && torrentInfo.files?.length) {
    const matched = fileMatchFn(torrentInfo.files);
    if (matched) {
      const url = await requestDownload(apiKey, torrentInfo.id, matched.id);
      if (url) return { url, file: matched, usedCreate: false };
    }
  }

  if (!torrentInfo && !skipCreate) {
    const created = await createTorrent(apiKey, magnetLink);
    if (!created) return { usedCreate: true };

    torrentInfo = await getTorrentInfo(apiKey, created.torrent_id);
    if (!torrentInfo?.files?.length) return { usedCreate: true };

    const matched = fileMatchFn(torrentInfo.files);
    if (!matched) return { usedCreate: true };

    const url = await requestDownload(apiKey, torrentInfo.id, matched.id);
    if (url) return { url, file: matched, usedCreate: true };
    return { usedCreate: true };
  }

  return null;
}

export async function deleteTorrent(apiKey: string, torrentId: number): Promise<void> {
  tbFetch(`${TB_BASE}/torrents/controltorrent`, {
    method: "POST",
    headers: { ...headers(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({ torrent_id: torrentId, operation: "delete" }),
  }).catch(() => {});
  invalidateMylist(apiKey);
}
