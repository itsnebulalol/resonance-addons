import { amFetch, isOnDeviceFetchSignal } from "../delegated-fetch";
import { getDeveloperToken } from "../token";
import { errorResponse, json } from "../utils";
import { searchSong } from "./search";

const API_BASE = "https://amp-api.music.apple.com";
const STOREFRONT = "us";

interface TrackMetadata {
  fullscreenArtworkURL: string | null;
  animatedArtworkURL: string | null;
  resolvedDurationSeconds: number | null;
  externalIDs: Record<string, string> | null;
}

const EMPTY_METADATA: TrackMetadata = {
  fullscreenArtworkURL: null,
  animatedArtworkURL: null,
  resolvedDurationSeconds: null,
  externalIDs: null,
};

export async function handleMetadata(title?: string, artist?: string): Promise<Response> {
  try {
    if (!title && !artist) {
      return json(EMPTY_METADATA);
    }

    const result = await searchSong(title ?? "", artist ?? "");
    if (!result) {
      return json(EMPTY_METADATA);
    }

    const metadata = await fetchMetadata(result.songId, result.durationSeconds);
    return json(metadata);
  } catch (e: any) {
    if (isOnDeviceFetchSignal(e)) {
      throw e;
    }
    console.error("[metadata] Error:", e.message);
    return errorResponse(e.message, 500);
  }
}

async function fetchMetadata(songId: string, durationSeconds: number | null): Promise<TrackMetadata> {
  const token = await getDeveloperToken();

  const songUrl = `${API_BASE}/v1/catalog/${STOREFRONT}/songs/${songId}?include=albums`;
  const songRes = await amFetch(songUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://music.apple.com",
      Referer: "https://music.apple.com/",
      Accept: "application/json",
    },
  });

  if (!songRes.ok) {
    console.error(`[metadata] Song fetch HTTP ${songRes.status}`);
    return {
      ...EMPTY_METADATA,
      resolvedDurationSeconds: durationSeconds,
      externalIDs: { appleMusicId: songId },
    };
  }

  const songData = (await songRes.json()) as any;
  const song = songData?.data?.[0];
  const attrs = song?.attributes;

  let fullscreenArtworkURL: string | null = null;
  if (attrs?.artwork?.url) {
    fullscreenArtworkURL = (attrs.artwork.url as string)
      .replace("{w}", "3000")
      .replace("{h}", "3000")
      .replace("{f}", "jpg")
      .replace("{c}", "sr");
  }

  let animatedArtworkURL: string | null = null;
  const albums = song?.relationships?.albums?.data as any[] | undefined;
  if (albums?.length) {
    const albumId = albums[0].id as string;
    animatedArtworkURL = await fetchAnimatedArtwork(albumId, token);
  }

  return {
    fullscreenArtworkURL,
    animatedArtworkURL,
    resolvedDurationSeconds: durationSeconds,
    externalIDs: { appleMusicId: songId },
  };
}

async function fetchAnimatedArtwork(albumId: string, token: string): Promise<string | null> {
  const url = `${API_BASE}/v1/catalog/${STOREFRONT}/albums/${albumId}?extend=editorialVideo`;
  const res = await amFetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://music.apple.com",
      Referer: "https://music.apple.com/",
      Accept: "application/json",
    },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as any;
  const attrs = data?.data?.[0]?.attributes;
  const video = attrs?.editorialVideo;
  if (!video) return null;

  const variants = ["motionDetailSquare", "motionSquareVideo1x1", "motionDetailTall", "motionTallVideo3x4"];

  for (const key of variants) {
    const v = video[key];
    if (v?.video) return v.video as string;
  }

  return null;
}
