import { AddonError } from "@resonance-addons/sdk";
import { transformGraphQLAlbumTrack } from "../track-mapping";
import type { AlbumDetail, Track } from "../types";
import { bestImageFromSources, formatTotalDuration, OperationHash, pf, uriToId } from "../utils";

function albumArtists(albumData: any): AlbumDetail["artists"] {
  return (albumData?.artists?.items ?? []).map((artist: any) => ({
    id: artist?.uri ? uriToId(artist.uri) : null,
    name: artist?.profile?.name ?? artist?.name ?? "",
  }));
}

export async function handleAlbum(spDc: string, albumId: string): Promise<AlbumDetail> {
  try {
    const data = await pf(spDc, {
      name: "getAlbum",
      hash: OperationHash.getAlbum,
      variables: {
        uri: `spotify:album:${albumId}`,
        locale: "",
        offset: 0,
        limit: 50,
      },
    });

    const albumData = data?.albumUnion;
    if (!albumData?.uri) {
      throw new AddonError("Album not found", 404);
    }

    const mappedTracks = (albumData?.tracksV2?.items ?? [])
      .map((item: any) => transformGraphQLAlbumTrack(item, albumData, albumId))
      .filter((track: Track | null): track is Track => track != null);
    const tracks = mappedTracks;

    return {
      id: uriToId(albumData.uri),
      title: albumData?.name ?? "",
      artists: albumArtists(albumData),
      year: typeof albumData?.date?.isoString === "string" ? albumData.date.isoString.slice(0, 4) : null,
      trackCount:
        typeof albumData?.tracksV2?.totalCount === "number"
          ? `${albumData.tracksV2.totalCount} songs`
          : tracks.length > 0
            ? `${tracks.length} songs`
            : null,
      duration: formatTotalDuration(tracks),
      thumbnailURL: bestImageFromSources(albumData?.coverArt?.sources ?? []),
      tracks,
      playlistId: albumData.uri,
    };
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to load album", 500);
  }
}
