import { getDeveloperToken, getUserToken } from "../token";
import { WidevineCDM } from "../widevine";

const PLAY_BASE = "https://play.itunes.apple.com/WebObjects/MZPlay.woa/wa";

export interface AMStreamResult {
  url: string;
  bitrate: number | null;
  durationSeconds: number | null;
  format: string | null;
  keyId: string; // hex
  key: string;   // hex AES-128 content key
}

async function playPost(path: string, body: any, dev: string, user: string): Promise<any> {
  const res = await fetch(`${PLAY_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${dev}`,
      "Music-User-Token": user,
      Origin: "https://music.apple.com",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

// trackId = Apple Music catalog song adamId
export async function handleStream(trackId: string): Promise<AMStreamResult> {
  console.log(`[stream] resolveStream trackId=${trackId}`);
  const dev = await getDeveloperToken();
  const user = getUserToken();
  if (!user) throw new Error("Apple Music user token not configured");

  // 1) webPlayback -> CENC (Widevine) flavor manifest
  const wp = await playPost("webPlayback", { salableAdamId: trackId, language: "en-US" }, dev, user);
  const assets: any[] = wp?.songList?.[0]?.assets ?? [];
  console.log(`[stream] webPlayback flavors=${assets.map((a) => a.flavor).join(",")}`);
  const asset = assets.find((a) => a.flavor === "28:ctrp256") ?? assets.find((a) => (a.flavor || "").includes("ctrp"));
  if (!asset?.URL) throw new Error("no CENC (ctrp) asset for track " + trackId);

  // 2) fetch the m3u8 -> KID + key URI
  const m3u8 = await (await fetch(asset.URL)).text();
  const keyLine = m3u8.split("\n").find((l) => l.startsWith("#EXT-X-KEY"));
  if (!keyLine) throw new Error("no EXT-X-KEY in manifest");
  const uriMatch = /URI="([^"]+)"/.exec(keyLine);
  if (!uriMatch) throw new Error("no key URI in manifest");
  const uri = uriMatch[1]!;
  const kid = Buffer.from(uri.split("base64,")[1]!, "base64");
  console.log(`[stream] KID=${kid.toString("hex")}`);

  const mapLine = m3u8.split("\n").find((l) => l.startsWith("#EXT-X-MAP"));
  const mapMatch = mapLine && /URI="([^"]+)"/.exec(mapLine);
  if (!mapMatch) throw new Error("no EXT-X-MAP in manifest");
  const mp4Url = new URL(mapMatch[1]!, asset.URL).href;

  // 3) Widevine L3: challenge -> license -> content key (pure JS)
  const cdm = new WidevineCDM();
  const challenge = cdm.getChallenge(kid);
  const lic = await playPost("acquireWebPlaybackLicense", {
    challenge: challenge.toString("base64"),
    "key-system": "com.widevine.alpha",
    uri,
    adamId: trackId,
    isLibrary: false,
    "user-initiated": true,
  }, dev, user);
  if (lic?.status !== 0 || !lic?.license) throw new Error("license error status=" + lic?.status);
  const ck = cdm.parseLicense(Buffer.from(lic.license, "base64"));
  console.log(`[stream] content key ready (kid=${ck.kid}) — returning encrypted fMP4 url + key`);

  return {
    url: mp4Url,
    bitrate: 256000,
    durationSeconds: null,
    format: "video/mp4",
    keyId: ck.kid,
    key: ck.key,
  };
}
