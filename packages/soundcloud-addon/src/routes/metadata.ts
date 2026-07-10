import { AddonError } from "@resonance-addons/sdk";
import {
  artworkURL,
  fetchTrack,
  PROVIDER_ID,
  type SoundCloudCollection,
  type SoundCloudConfig,
  type SoundCloudTrack,
  scFetch,
} from "../api";

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
  trackId?: string,
  trackProvider?: string,
): Promise<TrackMetadata> {
  try {
    let track: SoundCloudTrack | undefined;
    if (trackProvider === PROVIDER_ID && trackId?.trim()) {
      track = await fetchTrack(config, trackId);
    } else {
      if (!title && !artist) return EMPTY_METADATA;
      const query = [title, artist].filter(Boolean).join(" ");
      const data = await scFetch<SoundCloudCollection<SoundCloudTrack>>(config, "/search/tracks", {
        q: query,
        limit: 5,
        offset: 0,
      });
      track = data.collection?.[0];
    }
    if (!track?.id) return EMPTY_METADATA;

    const externalIDs: Record<string, string> = { soundCloudId: String(track.id) };
    if (track.publisher_metadata?.isrc?.trim()) {
      externalIDs.isrc = track.publisher_metadata.isrc.trim();
    }

    return {
      fullscreenArtworkURL: artworkURL(track.artwork_url, "original") ?? artworkURL(track.artwork_url),
      animatedArtworkURL: null,
      resolvedDurationSeconds: track.duration ? Math.round(track.duration / 1000) : null,
      externalIDs,
    };
  } catch (error: any) {
    console.error("[soundcloud:metadata] Error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}
