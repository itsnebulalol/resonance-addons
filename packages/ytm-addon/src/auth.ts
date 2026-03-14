const CLIENT_ID = "755973059757-iigsfdoqt2c4qm209soqp2dlrh33almr.apps.googleusercontent.com";
const TOKEN_URL = "https://oauthaccountmanager.googleapis.com/v1/issuetoken";
const INNERTUBE_BASE = "https://music.youtube.com/youtubei/v1";
const MOBILE_UA = "com.google.ios.youtubemusic/6.49 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";

const tokenCache = new Map<string, { token: string; expires: number }>();

const deviceIds = new Map<string, string>();

function getDeviceId(refreshToken: string): string {
  let id = deviceIds.get(refreshToken);
  if (!id) {
    id = crypto.randomUUID();
    deviceIds.set(refreshToken, id);
  }
  return id;
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
      "User-Agent": "com.google.ios.youtubemusic/9.06.4 iSL/3.4 iPhone/26.2.1 hw/iPhone18_4 (gzip)",
      "X-OAuth-Client-ID": CLIENT_ID,
      Accept: "*/*",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${text.slice(0, 200)}`);
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

const IOS_CONTEXT = {
  client: {
    clientName: "IOS_MUSIC",
    clientVersion: "6.49",
    hl: "en",
    gl: "US",
    platform: "MOBILE",
    osName: "iOS",
    osVersion: "18.3.2",
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
  },
  user: { lockedSafetyMode: false },
};

export async function ytFetch(endpoint: string, refreshToken: string, body: Record<string, any> = {}): Promise<any> {
  const accessToken = await mintAccessToken(refreshToken);

  const fullBody = {
    context: IOS_CONTEXT,
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
