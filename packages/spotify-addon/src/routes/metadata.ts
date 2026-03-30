import { getAccessToken } from "../auth";
import { searchSpotifyTrack } from "./search";

export async function handleMetadata(spDc: string, title?: string, artist?: string): Promise<any> {
  if (!title && !artist) {
    return {
      fullscreenArtworkURL: null,
      animatedArtworkURL: null,
      resolvedDurationSeconds: null,
      externalIDs: {},
    };
  }

  const token = await getAccessToken(spDc);
  const result = await searchSpotifyTrack(token, title ?? "", artist ?? "");
  if (!result) {
    return {
      fullscreenArtworkURL: null,
      animatedArtworkURL: null,
      resolvedDurationSeconds: null,
      externalIDs: {},
    };
  }

  const imageURL = result.image ? result.image.replace("ab67616d00001e02", "ab67616d0000b273") : null;

  return {
    fullscreenArtworkURL: imageURL,
    animatedArtworkURL: null,
    resolvedDurationSeconds: null,
    externalIDs: { spotifyId: result.id },
  };
}
