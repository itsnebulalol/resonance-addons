import { amFetch, isOnDeviceFetchSignal } from "./delegated-fetch";

let cachedDevToken: string | null = null;
let devTokenExpiresAt = 0;
let configuredUserToken: string | null = null;

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BASE = "https://music.apple.com";

export function setUserToken(token: string) {
  configuredUserToken = token;
}

export function getUserToken(): string | null {
  return configuredUserToken;
}

export async function getDeveloperToken(): Promise<string> {
  if (cachedDevToken && Date.now() < devTokenExpiresAt) {
    return cachedDevToken;
  }

  console.log("[token] Scraping developer token...");

  const html = await amFetch(BASE, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    },
  }).then((r) => r.text());

  const scriptUrls: string[] = [];
  for (const [, src] of html.matchAll(/src="([^"]+\.js[^"]*)"/g)) {
    scriptUrls.push(src!.startsWith("http") ? src! : `${BASE}${src}`);
  }

  scriptUrls.sort((a, b) => {
    const ai = a.includes("index") ? 0 : 1;
    const bi = b.includes("index") ? 0 : 1;
    return ai - bi;
  });

  console.log(`[token] Found ${scriptUrls.length} scripts`);

  for (const url of scriptUrls) {
    try {
      const js = await amFetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
          Referer: "https://music.apple.com/",
        },
      }).then((r) => r.text());

      const matches = js.match(JWT_RE);
      if (!matches) continue;

      for (const token of matches) {
        const exp = jwtExpiration(token);
        if (exp && exp > Date.now()) {
          console.log(`[token] Got dev token (expires ${new Date(exp).toISOString()})`);
          cachedDevToken = token;
          devTokenExpiresAt = exp - 60_000;
          return token;
        }
      }
    } catch (error) {
      if (isOnDeviceFetchSignal(error)) {
        throw error;
      }
    }
  }

  throw new Error("Failed to scrape developer token");
}

function jwtExpiration(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
