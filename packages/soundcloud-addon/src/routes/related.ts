import { AddonError } from "@resonance-addons/sdk";
import {
  playableTracks,
  resourceToHomeItem,
  type SoundCloudCollection,
  type SoundCloudConfig,
  type SoundCloudTrack,
  scFetch,
} from "../api";
import type { Track } from "../types";

function tracksFromCollection(data: SoundCloudCollection<SoundCloudTrack>): Track[] {
  return playableTracks(data.collection ?? [])
    .map((track) => resourceToHomeItem(track))
    .flatMap((item) => (item?.type === "track" ? [item.track] : []));
}

export async function handleRelated(config: SoundCloudConfig, browseId: string): Promise<Track[]> {
  try {
    const data = await scFetch<SoundCloudCollection<SoundCloudTrack>>(
      config,
      browseId.startsWith("http") ? browseId : `/tracks/${encodeURIComponent(browseId)}/related`,
      {
        limit: 50,
        offset: 0,
        linked_partitioning: 1,
      },
    );
    return tracksFromCollection(data);
  } catch (error: any) {
    console.error("[soundcloud:related] Error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}

export async function handleRelatedForTrack(config: SoundCloudConfig, trackId: string): Promise<Track[]> {
  return handleRelated(config, trackId);
}
