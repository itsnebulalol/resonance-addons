import { AddonError } from "@resonance-addons/sdk";
import type { ArtistDetail, SearchAlbum, SearchArtist } from "../types";
import {
  bestImageFromSources,
  formatFollowers,
  OperationHash,
  PROVIDER_ID,
  pf,
  transformGraphQLTrack,
  uriToId,
} from "../utils";

function mapTracks(items: any[] | undefined): ArtistDetail["topTracks"] {
  const tracks: ArtistDetail["topTracks"] = [];
  for (const item of items ?? []) {
    const trackData = item?.track ?? item?.data ?? item;
    if (!trackData?.uri || !String(trackData.uri).startsWith("spotify:track:")) continue;
    tracks.push(transformGraphQLTrack(trackData));
  }
  return tracks;
}

function releaseArtists(release: any, fallbackArtistId: string, fallbackArtistName: string): SearchAlbum["artists"] {
  const artists = (release?.artists?.items ?? []).map((artist: any) => ({
    id: artist?.uri ? uriToId(artist.uri) : null,
    name: artist?.profile?.name ?? artist?.name ?? "",
  }));
  if (artists.length > 0) return artists;
  return [{ id: fallbackArtistId, name: fallbackArtistName }];
}

function mapReleases(items: any[] | undefined, fallbackArtistId: string, fallbackArtistName: string): SearchAlbum[] {
  const albums: SearchAlbum[] = [];
  const seen = new Set<string>();

  for (const item of items ?? []) {
    for (const release of item?.releases?.items ?? []) {
      const uri = release?.uri as string | undefined;
      const name = release?.name as string | undefined;
      if (!uri || !name) continue;

      const id = uriToId(uri);
      if (seen.has(id)) continue;
      seen.add(id);

      albums.push({
        id,
        provider: PROVIDER_ID,
        title: name,
        artists: releaseArtists(release, fallbackArtistId, fallbackArtistName),
        year: typeof release?.date?.isoString === "string" ? release.date.isoString.slice(0, 4) : null,
        thumbnailURL: bestImageFromSources(release?.coverArt?.sources ?? []),
        isExplicit: false,
      });
    }
  }

  return albums;
}

function mapRelatedArtists(items: any[] | undefined): SearchArtist[] {
  const artists: SearchArtist[] = [];
  const seen = new Set<string>();

  for (const item of items ?? []) {
    const uri = item?.uri as string | undefined;
    const name = item?.profile?.name as string | undefined;
    if (!uri || !name) continue;

    const id = uriToId(uri);
    if (seen.has(id)) continue;
    seen.add(id);

    artists.push({
      id,
      provider: PROVIDER_ID,
      name,
      thumbnailURL: bestImageFromSources(item?.visuals?.avatarImage?.sources ?? []),
      subscriberCount: formatFollowers(item?.stats?.followers),
    });
  }

  return artists;
}

function buildSubtitle(stats: any): string | null {
  const monthlyListeners = formatFollowers(stats?.monthlyListeners);
  const followers = formatFollowers(stats?.followers);

  if (monthlyListeners && followers) {
    return `${monthlyListeners} monthly listeners • ${followers} followers`;
  }
  if (monthlyListeners) {
    return `${monthlyListeners} monthly listeners`;
  }
  if (followers) {
    return `${followers} followers`;
  }
  return null;
}

export async function handleArtist(spDc: string, artistId: string): Promise<ArtistDetail> {
  try {
    const data = await pf(spDc, {
      name: "queryArtistOverview",
      hash: OperationHash.queryArtistOverview,
      variables: {
        uri: `spotify:artist:${artistId}`,
        locale: "",
        includePrerelease: true,
      },
    });

    const artistData = data?.artistUnion;
    if (!artistData?.uri) {
      throw new AddonError("Artist not found", 404);
    }

    return {
      id: uriToId(artistData.uri),
      name: artistData?.profile?.name ?? "",
      thumbnailURL: bestImageFromSources(artistData?.visuals?.avatarImage?.sources ?? []),
      subtitle: buildSubtitle(artistData?.stats),
      topTracks: mapTracks(artistData?.discography?.topTracks?.items),
      albums: mapReleases(
        artistData?.discography?.albums?.items,
        uriToId(artistData.uri),
        artistData?.profile?.name ?? "",
      ),
      singles: mapReleases(
        artistData?.discography?.singles?.items,
        uriToId(artistData.uri),
        artistData?.profile?.name ?? "",
      ),
      playlists: [],
      relatedArtists: mapRelatedArtists(artistData?.relatedContent?.relatedArtists?.items),
    };
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to load artist", 500);
  }
}
