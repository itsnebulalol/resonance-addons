import { AddonError } from "@resonance-addons/sdk";
import { OperationHash, pf } from "../utils";

export async function handleGetLikeStatus(spDc: string, trackId: string): Promise<string> {
  try {
    const data = await pf(spDc, {
      name: "areEntitiesInLibrary",
      hash: OperationHash.areEntitiesInLibrary,
      variables: {
        uris: [`spotify:track:${trackId}`],
      },
    });

    return data?.lookup?.[0]?.data?.saved ? "liked" : "none";
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to get like status", 500);
  }
}

export async function handleSetLikeStatus(spDc: string, status: string, trackId: string): Promise<void> {
  try {
    const targetStatus = status === "liked" ? "liked" : "none";
    const operation =
      targetStatus === "liked"
        ? { name: "addToLibrary", hash: OperationHash.addToLibrary }
        : { name: "removeFromLibrary", hash: OperationHash.removeFromLibrary };

    await pf(spDc, {
      name: operation.name,
      hash: operation.hash,
      variables: {
        libraryItemUris: [`spotify:track:${trackId}`],
      },
    });
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to set like status", 500);
  }
}

export async function handleAddToPlaylist(_spDc: string, trackId: string, playlistId: string): Promise<void> {
  try {
    if (!trackId || !playlistId) {
      throw new AddonError("Missing trackId or playlistId", 400);
    }

    throw new AddonError(
      "Adding tracks to Spotify playlists is not supported yet with the current internal API mapping",
      501,
    );
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to add to playlist", 500);
  }
}
