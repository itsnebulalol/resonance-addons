import { AddonError } from "@resonance-addons/sdk";
import {
  playableTracks,
  resourceToHomeItem,
  type SoundCloudCollection,
  type SoundCloudConfig,
  type SoundCloudTrack,
  scFetch,
} from "../api";
import type { CatalogPage, HomeItem, HomeSection } from "../types";

interface ChartItem {
  track?: SoundCloudTrack | null;
}

export async function handleHome(config: SoundCloudConfig, continuation?: string): Promise<CatalogPage> {
  try {
    if (continuation) {
      const data = await scFetch<SoundCloudCollection<ChartItem | SoundCloudTrack>>(config, continuation);
      const items = homeItems(data);
      return {
        sections: items.length
          ? [
              {
                id: crypto.randomUUID(),
                title: "More tracks",
                items,
                style: "cards",
                continuationToken: data.next_href ?? undefined,
              },
            ]
          : [],
        filters: [],
        quickAccess: null,
        continuation: data.next_href ? { providerID: "com.resonance.soundcloud", token: data.next_href } : null,
      };
    }

    const results = await Promise.allSettled([
      scFetch<SoundCloudCollection<ChartItem>>(config, "/charts", {
        kind: "trending",
        genre: "soundcloud:genres:all-music",
        limit: 20,
        offset: 0,
      }),
      scFetch<SoundCloudCollection<SoundCloudTrack>>(config, "/search/tracks", {
        q: "electronic",
        limit: 20,
        offset: 0,
        linked_partitioning: 1,
      }),
    ]);
    const definitions = [
      { title: "Trending on SoundCloud", style: "quickPicks" as const },
      { title: "Electronic picks", style: "cards" as const },
    ];

    const sections: HomeSection[] = [];
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      const definition = definitions[index];
      if (!definition || result?.status !== "fulfilled") continue;
      const items = homeItems(result.value);
      if (!items.length) continue;
      sections.push({
        id: crypto.randomUUID(),
        title: definition.title,
        items,
        style: definition.style,
        continuationToken: result.value.next_href ?? undefined,
      });
    }

    return { sections, filters: [], quickAccess: null, continuation: null };
  } catch (error: any) {
    console.error("[soundcloud:catalog] Home error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}

function homeItems(data: SoundCloudCollection<ChartItem | SoundCloudTrack>): HomeItem[] {
  const tracks = (data.collection ?? [])
    .map((item) => ("track" in item && item.track ? item.track : item))
    .filter((item): item is SoundCloudTrack => !("track" in item))
    .filter((track): track is SoundCloudTrack => Boolean(track?.id));

  return playableTracks(tracks)
    .map((track) => resourceToHomeItem(track))
    .filter((item): item is HomeItem => Boolean(item));
}
