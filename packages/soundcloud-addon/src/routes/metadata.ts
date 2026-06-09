import { AddonError } from "@resonance-addons/sdk";
import { artworkURL, type SoundCloudCollection, type SoundCloudConfig, type SoundCloudTrack, scFetch } from "../api";

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
  config: SoundCloudConfig,
  title?: string,
  artist?: string,
): Promise<TrackMetadata> {
  try {
    if (!title && !artist) return EMPTY_METADATA;
    const query = [title, artist].filter(Boolean).join(" ");
    const data = await scFetch<SoundCloudCollection<SoundCloudTrack>>(config, "/search/tracks", {
      q: query,
      limit: 5,
      offset: 0,
    });
    const track = data.collection?.[0];
    if (!track?.id) return EMPTY_METADATA;

    return {
      fullscreenArtworkURL: artworkURL(track.artwork_url, "original") ?? artworkURL(track.artwork_url),
      animatedArtworkURL: null,
      resolvedDurationSeconds: track.duration ? Math.round(track.duration / 1000) : null,
      externalIDs: { soundCloudId: String(track.id) },
    };
  } catch (error: any) {
    console.error("[soundcloud:metadata] Error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}
