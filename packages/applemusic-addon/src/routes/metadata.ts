import { AddonError } from "@resonance-addons/sdk";
import { getStorefront, PROVIDER_ID } from "../api";
import { amFetch } from "../cached-fetch";
import { catalogURL } from "../storefront";
import { getDeveloperToken } from "../token";
import { searchSong } from "./search";

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

export async function handleMetadata(
  title?: string,
  artist?: string,
  trackId?: string,
  trackProvider?: string,
): Promise<TrackMetadata> {
  try {
    const exactSongId = trackProvider === PROVIDER_ID ? trackId?.trim() : undefined;
    let songId = exactSongId;
    let durationSeconds: number | null = null;
    let storefront: string;

    if (songId) {
      storefront = await getStorefront();
    } else {
      if (!title && !artist) {
        return EMPTY_METADATA;
      }

      console.log(`[metadata] Searching: "${title}" — "${artist}"`);
      const result = await searchSong(title ?? "", artist ?? "");
      if (!result) {
        console.log("[metadata] No search result");
        return EMPTY_METADATA;
      }
      songId = result.songId;
      durationSeconds = result.durationSeconds;
      storefront = result.storefront;
    }

    console.log(`[metadata] Resolved songId=${songId}`);

    const metadata = await fetchMetadata(songId, durationSeconds, storefront);
    console.log(`[metadata] Got artwork: ${metadata.fullscreenArtworkURL ? "yes" : "no"}`);
    return metadata;
  } catch (e: any) {
    console.error("[metadata] Error:", e?.message ?? e?.toString?.() ?? JSON.stringify(e));
    throw new AddonError(e?.message ?? "Unknown metadata error", 500);
  }
}

async function fetchMetadata(
  songId: string,
  durationSeconds: number | null,
  storefront: string,
): Promise<TrackMetadata> {
  const token = await getDeveloperToken();

  const songUrl = `${catalogURL(storefront, `/songs/${songId}`)}?include=albums`;
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
  const externalIDs: Record<string, string> = { appleMusicId: songId };
  if (typeof attrs?.isrc === "string" && attrs.isrc.trim()) {
    externalIDs.isrc = attrs.isrc.trim();
  }

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
    animatedArtworkURL = await fetchAnimatedArtwork(albumId, storefront, token);
  }

  return {
    fullscreenArtworkURL,
    animatedArtworkURL,
    resolvedDurationSeconds:
      typeof attrs?.durationInMillis === "number" ? Math.round(attrs.durationInMillis / 1000) : durationSeconds,
    externalIDs,
  };
}

async function fetchAnimatedArtwork(albumId: string, storefront: string, token: string): Promise<string | null> {
  const url = `${catalogURL(storefront, `/albums/${albumId}`)}?extend=editorialVideo`;
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
