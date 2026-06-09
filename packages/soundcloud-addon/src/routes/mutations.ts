import { AddonError } from "@resonance-addons/sdk";
import { hasOAuth, requireOAuth, type SoundCloudCollection, type SoundCloudConfig, scFetch } from "../api";

async function allIds(config: SoundCloudConfig, endpoint: string): Promise<Set<string>> {
  requireOAuth(config);
  const ids = new Set<string>();
  let next: string | null = endpoint;

  while (next) {
    const data: SoundCloudCollection<number> = await scFetch(config, next, { limit: 200, linked_partitioning: 1 });
    for (const id of data.collection ?? []) ids.add(String(id));
    next = data.next_href ?? null;
    if (ids.size > 2000) break;
  }

  return ids;
}

export async function handleGetLikeStatus(config: SoundCloudConfig, trackId: string): Promise<"liked" | "none"> {
  if (!hasOAuth(config)) return "none";

  try {
    const ids = await allIds(config, "/me/track_likes/ids");
    return ids.has(String(trackId)) ? "liked" : "none";
  } catch (error: any) {
    console.error("[soundcloud:mutations] Get like status error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}

export async function handleLike(
  config: SoundCloudConfig,
  _status: "liked" | "disliked" | "none",
  _trackId: string,
): Promise<{ success: true }> {
  requireOAuth(config);
  throw new AddonError(
    "Changing SoundCloud like status is not supported yet: the current web OAuth token exposes like reads, but the live v2 mutation endpoints tested returned 404.",
    501,
  );
}
