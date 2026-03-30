import { AddonError } from "@resonance-addons/sdk";
import type { AlbumDetail, Track } from "../types";
import { bestImageFromSources, formatTotalDuration, OperationHash, pf, transformGraphQLTrack, uriToId } from "../utils";

function albumArtists(albumData: any): AlbumDetail["artists"] {
  return (albumData?.artists?.items ?? []).map((artist: any) => ({
    id: artist?.uri ? uriToId(artist.uri) : null,
    name: artist?.profile?.name ?? artist?.name ?? "",
  }));
}

function albumTrack(trackEntry: any, albumData: any, fallbackAlbumId: string): Track | null {
  const rawTrack = trackEntry?.track ?? trackEntry;
  if (!rawTrack?.uri) return null;

  const normalizedTrack = rawTrack?.albumOfTrack
    ? rawTrack
    : {
        ...rawTrack,
        albumOfTrack: {
          uri: albumData?.uri ?? `spotify:album:${fallbackAlbumId}`,
          name: albumData?.name ?? "",
          coverArt: albumData?.coverArt ?? null,
        },
      };

  const mapped = transformGraphQLTrack(normalizedTrack);
  const albumUri = (albumData?.uri as string | undefined) ?? `spotify:album:${fallbackAlbumId}`;

  return {
    ...mapped,
    album: {
      id: uriToId(albumUri),
      name: albumData?.name ?? mapped.album?.name ?? "",
    },
    thumbnailURL: mapped.thumbnailURL ?? bestImageFromSources(albumData?.coverArt?.sources ?? []),
  };
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

    const tracks = (albumData?.tracksV2?.items ?? [])
      .map((item: any) => albumTrack(item, albumData, albumId))
      .filter((track: Track | null): track is Track => track != null);

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
