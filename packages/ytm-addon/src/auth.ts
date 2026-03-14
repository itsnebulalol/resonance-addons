import { createHash } from "node:crypto";

const CLIENT_ID = "755973059757-iigsfdoqt2c4qm209soqp2dlrh33almr.apps.googleusercontent.com";
const TOKEN_URL = "https://oauthaccountmanager.googleapis.com/v1/issuetoken";
const INNERTUBE_BASE = "https://music.youtube.com/youtubei/v1";
const IOS_CLIENT_VERSION = "9.10";
const MOBILE_UA = `com.google.ios.youtubemusic/${IOS_CLIENT_VERSION} (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)`;

const tokenCache = new Map<string, { token: string; expires: number }>();

export function getDeviceId(refreshToken: string): string {
  const hash = createHash("sha256").update(refreshToken).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function mintAccessToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expires > Date.now()) {
    return cached.token;
  }

  const scopes = ["https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.force-ssl"].join(
    " ",
  );

  const body = new URLSearchParams({
    app_id: "com.google.ios.youtubemusic",
    client_id: CLIENT_ID,
    device_id: getDeviceId(refreshToken),
    hl: "en-US",
    lib_ver: "3.4",
    response_type: "token",
    scope: scopes,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${refreshToken}`,
      "User-Agent": `com.google.ios.youtubemusic/${IOS_CLIENT_VERSION} iSL/3.4 iPhone/26.2.1 hw/iPhone18_4 (gzip)`,
      "X-OAuth-Client-ID": CLIENT_ID,
      Accept: "*/*",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    const hint =
      res.status === 401
        ? " Google rejected the supplied account token before any YouTube Music request was made."
        : "";
    throw new Error(`OAuth token refresh failed (${res.status}): ${text.slice(0, 200)}${hint}`);
  }

  const data = (await res.json()) as { token: string; expiresIn?: string };
  const expiresIn = data.expiresIn ? parseInt(data.expiresIn, 10) : 3600;
  tokenCache.set(refreshToken, {
    token: data.token,
    expires: Date.now() + (expiresIn - 60) * 1000,
  });

  console.log(`[auth] Minted access token (expires in ${expiresIn}s)`);
  return data.token;
}

export function buildIosContext() {
  return {
    client: {
      clientName: "IOS_MUSIC",
      clientVersion: IOS_CLIENT_VERSION,
      hl: "en",
      platform: "MOBILE",
      osName: "iOS",
      osVersion: "18.3.2",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
    },
    user: { lockedSafetyMode: false },
  };
}

export async function ytFetch(endpoint: string, refreshToken: string, body: Record<string, any> = {}): Promise<any> {
  const accessToken = await mintAccessToken(refreshToken);

  const fullBody = {
    context: buildIosContext(),
    ...body,
  };

  const res = await fetch(`${INNERTUBE_BASE}/${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": MOBILE_UA,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(fullBody),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`InnerTube ${endpoint} failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json();
}
