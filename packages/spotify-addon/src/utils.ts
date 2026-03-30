import { getAccessToken, type PathfinderOperation, pathfinderRequest, spotifyFetch } from "./auth";
import type { ArtistRef, Track } from "./types";

export const PROVIDER_ID = "com.resonance.spotify";

export const OperationHash = {
  profileAttributes: "53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced",
  getAlbum: "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10",
  getTrack: "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294",
  queryArtistOverview: "446130b4a0aa6522a686aafccddb0ae849165b5e0436fd802f96e0243617b5d8",
  fetchPlaylist: "bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77",
  libraryV3: "9f4da031f81274d572cfedaf6fc57a737c84b43d572952200b2c36aaa8fec1c6",
  fetchLibraryTracks: "087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240",
  areEntitiesInLibrary: "134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed",
  addToLibrary: "7c5a69420e2bfae3da5cc4e14cbc8bb3f6090f80afc00ffc179177f19be3f33d",
  removeFromLibrary: "7c5a69420e2bfae3da5cc4e14cbc8bb3f6090f80afc00ffc179177f19be3f33d",
  userTopContent: "49ee15704de4a7fdeac65a02db20604aa11e46f02e809c55d9a89f6db9754356",
  internalLinkRecommenderTrack: "c77098ee9d6ee8ad3eb844938722db60570d040b49f41f5ec6e7be9160a7c86b",
  homeSection: "c11ff5d8f508cb1a3dad3f15ee80611cda7df7e6fb45212e466fb3e84a680bf9",
  home: "eb3fba2d388cf4fc4d696b1757a58584e9538a3b515ea742e9cc9465807340be",
};

export function uriToId(uri: string): string {
  return uri.split(":").pop() ?? uri;
}

export function bestImageFromSources(sources: any[]): string | null {
  if (!sources?.length) return null;
  const pref =
    sources.find((s: any) => s.height === 640) ??
    sources.find((s: any) => s.height === 300 || s.height === 320) ??
    sources[0];
  return pref?.url ?? null;
}

export function formatDurationMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatFollowers(n: number | undefined | null): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatTotalDuration(tracks: Track[]): string | null {
  const totalSec = tracks.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
  if (totalSec === 0) return null;
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours} hr ${mins} min`;
  return `${mins} min`;
}

export function transformGraphQLTrack(trackData: any): Track {
  const uri = trackData.uri as string | undefined;
  const id = uri ? uriToId(uri) : (trackData.id ?? "");

  const artistsData = trackData.artists ?? trackData.firstArtist;
  const artists: ArtistRef[] = (artistsData?.items ?? []).map((a: any) => ({
    id: a.uri ? uriToId(a.uri) : null,
    name: a.profile?.name ?? a.name ?? "",
  }));

  const albumData = trackData.albumOfTrack;
  const album = albumData
    ? {
        id: albumData.uri ? uriToId(albumData.uri) : null,
        name: albumData.name ?? "",
      }
    : null;

  const durationMs = trackData.trackDuration?.totalMilliseconds ?? trackData.duration?.totalMilliseconds ?? 0;
  const isExplicit = trackData.contentRating?.label === "EXPLICIT";
  const coverSources = albumData?.coverArt?.sources ?? [];
  const thumbnailURL = bestImageFromSources(coverSources);

  return {
    id,
    provider: PROVIDER_ID,
    title: trackData.name ?? "",
    artists,
    album,
    duration: durationMs > 0 ? formatDurationMs(durationMs) : null,
    durationSeconds: durationMs > 0 ? Math.round(durationMs / 1000) : null,
    thumbnailURL,
    isExplicit,
  };
}

export async function pf(spDc: string, op: PathfinderOperation): Promise<any> {
  const result = await pathfinderRequest(spDc, op);
  return result?.data;
}

export async function spclientGet(spDc: string, path: string): Promise<any> {
  const token = await getAccessToken(spDc);
  const res = await spotifyFetch(`https://spclient.wg.spotify.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "app-platform": "WebPlayer",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`spclient ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function getUserId(spDc: string): Promise<string> {
  const data = await pf(spDc, {
    name: "profileAttributes",
    hash: OperationHash.profileAttributes,
    variables: {},
  });
  const uri = data?.me?.profile?.uri as string | undefined;
  if (!uri) throw new Error("Could not get user profile");
  return uriToId(uri);
}

export { getAccessToken, spotifyFetch } from "./auth";
