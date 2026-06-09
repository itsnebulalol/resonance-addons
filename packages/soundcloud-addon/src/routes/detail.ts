import { AddonError } from "@resonance-addons/sdk";
import {
  artworkURL,
  countText,
  fetchPlaylist,
  fetchUser,
  hydrateTracks,
  isAlbumSet,
  msToDuration,
  playableTracks,
  playlistToSearchAlbum,
  playlistToSearchPlaylist,
  playlistTracks,
  resourceToHomeItem,
  type SoundCloudCollection,
  type SoundCloudConfig,
  type SoundCloudPlaylist,
  type SoundCloudTrack,
  type SoundCloudUser,
  scFetch,
  soundCloudTracksToTracks,
  userDisplayName,
  userToSearchArtist,
} from "../api";
import type {
  AlbumDetail,
  ArtistDetail,
  PlaylistDetail,
  SearchAlbum,
  SearchArtist,
  SearchPlaylist,
  Track,
  TrackPage,
} from "../types";

export async function handleAlbum(config: SoundCloudConfig, playlistId: string): Promise<AlbumDetail> {
  try {
    const playlist = await fetchPlaylist(config, playlistId);
    const album = playlistToSearchAlbum(playlist);
    const tracks = (await playlistTracks(config, playlist)).filter((track) => track.id);
    return {
      id: String(playlist.id ?? playlistId),
      title: playlist.title ?? "",
      artists: album.artists,
      year: album.year,
      trackCount: countText(playlist.track_count ?? tracks.length, "track"),
      duration: msToDuration(playlist.duration),
      thumbnailURL: album.thumbnailURL,
      tracks,
      playlistId: String(playlist.id ?? playlistId),
    };
  } catch (error: any) {
    console.error("[soundcloud:detail] Album error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}

export async function handlePlaylist(config: SoundCloudConfig, playlistId: string): Promise<PlaylistDetail> {
  try {
    const playlist = await fetchPlaylist(config, playlistId);
    const tracks = (await playlistTracks(config, playlist)).filter((track) => track.id);
    return {
      id: String(playlist.id ?? playlistId),
      title: playlist.title ?? "",
      author: userDisplayName(playlist.user),
      description: playlist.description ?? null,
      trackCount: countText(playlist.track_count ?? tracks.length, "track"),
      thumbnailURL:
        artworkURL(playlist.artwork_url) ??
        artworkURL(playlist.tracks?.[0]?.artwork_url) ??
        artworkURL(playlist.user?.avatar_url),
      tracks,
      continuation: null,
    };
  } catch (error: any) {
    console.error("[soundcloud:detail] Playlist error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}

export async function handlePlaylistMore(
  config: SoundCloudConfig,
  _playlistId: string,
  continuation: string,
): Promise<TrackPage> {
  try {
    const data = await scFetch<SoundCloudCollection<SoundCloudTrack | { track?: SoundCloudTrack }>>(
      config,
      continuation,
    );
    const rawTracks = (data.collection ?? [])
      .map((item) => ("track" in item && item.track ? item.track : item))
      .filter((item): item is SoundCloudTrack => !("track" in item))
      .filter((track): track is SoundCloudTrack => Boolean(track?.id));
    return {
      tracks: soundCloudTracksToTracks(await hydrateTracks(config, rawTracks)),
      continuation: data.next_href ?? null,
    };
  } catch (error: any) {
    console.error("[soundcloud:detail] Playlist continuation error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}

export async function handleArtist(config: SoundCloudConfig, userId: string): Promise<ArtistDetail> {
  try {
    const user = await fetchUser(config, userId);
    const id = String(user.id ?? userId);

    const [tracksResult, playlistsResult, followingResult] = await Promise.allSettled([
      scFetch<SoundCloudCollection<SoundCloudTrack>>(config, `/users/${encodeURIComponent(id)}/tracks`, {
        limit: 25,
        offset: 0,
        linked_partitioning: 1,
      }),
      scFetch<SoundCloudCollection<SoundCloudPlaylist>>(config, `/users/${encodeURIComponent(id)}/playlists`, {
        limit: 50,
        offset: 0,
        linked_partitioning: 1,
      }),
      scFetch<SoundCloudCollection<SoundCloudUser>>(config, `/users/${encodeURIComponent(id)}/followings`, {
        limit: 12,
        offset: 0,
        linked_partitioning: 1,
      }),
    ]);

    const topTracks: Track[] =
      tracksResult.status === "fulfilled"
        ? playableTracks(tracksResult.value.collection ?? [])
            .map((track) => resourceToHomeItem(track))
            .flatMap((item) => (item?.type === "track" ? [item.track] : []))
        : [];

    const albums: SearchAlbum[] = [];
    const singles: SearchAlbum[] = [];
    const playlists: SearchPlaylist[] = [];
    if (playlistsResult.status === "fulfilled") {
      for (const playlist of playlistsResult.value.collection ?? []) {
        if (isAlbumSet(playlist)) {
          const album = playlistToSearchAlbum(playlist);
          const setType = playlist.set_type?.toLowerCase() ?? "";
          if (setType === "single" || setType === "ep") singles.push(album);
          else albums.push(album);
        } else {
          playlists.push(playlistToSearchPlaylist(playlist));
        }
      }
    }

    const relatedArtists: SearchArtist[] =
      followingResult.status === "fulfilled" ? (followingResult.value.collection ?? []).map(userToSearchArtist) : [];

    return {
      id,
      name: userDisplayName(user) ?? "",
      thumbnailURL: artworkURL(user.avatar_url),
      subtitle: countText(user.followers_count, "follower"),
      topTracks,
      albums,
      singles,
      playlists,
      relatedArtists,
    };
  } catch (error: any) {
    console.error("[soundcloud:detail] Artist error:", error.message);
    if (error instanceof AddonError) throw error;
    throw new AddonError(error.message, 500);
  }
}
