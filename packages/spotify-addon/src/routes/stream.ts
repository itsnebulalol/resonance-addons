import { getAccessToken, getClientToken } from "../auth";
import { WidevineCDM, psshInitData } from "../widevine";

const APP_VERSION = "1.2.80.313.gd1726b65";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const SPCLIENT = "https://spclient.wg.spotify.com";

export interface SpotifyStreamResult {
  url: string;
  bitrate: number | null;
  durationSeconds: number | null;
  format: string | null;
  keyId: string; // hex
  key: string;   // hex AES-128 content key
}

function authHeaders(token: string, clientToken: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "client-token": clientToken,
    "app-platform": "WebPlayer",
    "spotify-app-version": APP_VERSION,
    "User-Agent": UA,
    Origin: "https://open.spotify.com",
    ...extra,
  };
}

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url.split("?")[0]} HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

async function getBuffer(url: string, headers: Record<string, string>): Promise<Buffer> {
  const res = await fetch(url, { headers });
  return Buffer.from(await res.arrayBuffer());
}

const wvdCache = new Map<string, Promise<Buffer>>();
function loadWvd(wvdUrl: string): Promise<Buffer> {
  let p = wvdCache.get(wvdUrl);
  if (!p) {
    p = getBuffer(wvdUrl, { "User-Agent": UA }).then((wvd) => {
      if (!(wvd[0] === 0x57 && wvd[1] === 0x56 && wvd[2] === 0x44)) {
        throw new Error(`wvd URL did not return a valid .wvd file (${wvd.length}b)`);
      }
      return wvd;
    });
    p.catch(() => wvdCache.delete(wvdUrl));
    wvdCache.set(wvdUrl, p);
  }
  return p;
}

function findBox(buf: Buffer, type: string): number {
  const a = type.charCodeAt(0), b = type.charCodeAt(1), c = type.charCodeAt(2), d = type.charCodeAt(3);
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === a && buf[i + 1] === b && buf[i + 2] === c && buf[i + 3] === d) return i;
  }
  return -1;
}

export async function handleStream(spDc: string, trackId: string, wvdUrl?: string): Promise<SpotifyStreamResult> {
  console.log(`[stream] resolveStream trackId=${trackId}`);
  if (!wvdUrl) throw new Error("streaming requires a Widevine device (.wvd) URL — set one in the addon configuration");
  const token = await getAccessToken(spDc);
  const clientToken = await getClientToken();
  const h = authHeaders(token, clientToken, { Accept: "application/json" });

  // 1) track-playback manifest -> Widevine CENC MP4/AAC file id
  const fmts = "manifestFileFormat=file_ids_mp4&manifestFileFormat=file_ids_mp4_dual";
  const media = await getJson(`${SPCLIENT}/track-playback/v1/media/spotify:track:${trackId}?${fmts}`, h);
  const mediaMap = media?.media ?? {};
  const entry: any = mediaMap[`spotify:track:${trackId}`] ?? Object.values(mediaMap)[0];
  const item = entry?.item;
  const manifest = item?.manifest ?? {};
  const candidates: any[] = [...(manifest.file_ids_mp4 ?? []), ...(manifest.file_ids_mp4_dual ?? [])];
  if (!candidates.length) throw new Error("no MP4 (Widevine) file for track " + trackId);
  const chosen = candidates.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  const fileId: string = chosen.file_id;
  const durationMs = item?.metadata?.duration ?? item?.metadata?.length ?? null;
  console.log(`[stream] file_id=${fileId} fmt=${chosen.format} bitrate=${chosen.bitrate}`);

  // 2) storage-resolve -> CDN url for the complete encrypted fMP4
  const sr = await getJson(`${SPCLIENT}/storage-resolve/files/audio/interactive/${fileId}?alt=json`, h);
  const cdnUrl: string = sr?.cdnurl?.[0];
  if (!cdnUrl) throw new Error("storage-resolve returned no CDN url");

  // 3) read the fMP4 header -> pssh box (Widevine init data) + default KID (tenc)
  const head = await getBuffer(cdnUrl, { Range: "bytes=0-65535", "User-Agent": UA });
  const ti = findBox(head, "tenc");
  if (ti < 0) throw new Error(`no tenc box in stream header (${head.length}b)`);
  const kidHex = head.subarray(ti + 12, ti + 28).toString("hex");
  const pi = findBox(head, "pssh");
  if (pi < 4) throw new Error("no pssh box in stream header");
  const psshSize = head.readUInt32BE(pi - 4);
  const psshBox = head.subarray(pi - 4, pi - 4 + psshSize);
  const initData = psshInitData(psshBox);

  // 4) Widevine privacy-mode license exchange -> content key
  const cdm = new WidevineCDM(await loadWvd(wvdUrl));
  const cert = await getBuffer(`${SPCLIENT}/widevine-license/v1/application-certificate`, authHeaders(token, clientToken));
  cdm.setServiceCertificate(cert);
  const challenge = cdm.getChallenge(initData);
  const licRes = await fetch(`${SPCLIENT}/widevine-license/v1/audio/license`, {
    method: "POST",
    headers: authHeaders(token, clientToken, { "Content-Type": "application/octet-stream" }),
    body: challenge,
  });
  if (!licRes.ok) throw new Error(`widevine license HTTP ${licRes.status}`);
  const license = Buffer.from(await licRes.arrayBuffer());
  const ck = cdm.parseLicense(license);
  console.log(`[stream] content key ready (kid=${ck.kid}) — returning encrypted fMP4 url + key`);

  return {
    url: cdnUrl,
    bitrate: chosen.bitrate ?? 256000,
    durationSeconds: durationMs ? Math.round(durationMs / 1000) : null,
    format: "video/mp4",
    keyId: ck.kid,
    key: ck.key,
  };
}
