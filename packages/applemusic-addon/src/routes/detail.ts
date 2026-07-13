import { albumToSearch, ampGet, artistToSearch, artworkURL, getStorefront, msToDuration, songToTrack } from "../api";
import type { AlbumDetail, ArtistDetail, PlaylistDetail, SearchAlbum, SearchArtist, Track, TrackPage } from "../models";

const isLib = (id: string, prefix: string) => id.startsWith(prefix);

// ---------- Album ----------
export async function handleAlbum(id: string): Promise<AlbumDetail> {
  const sf = await getStorefront();
  const path = isLib(id, "l.") ? `/v1/me/library/albums/${id}` : `/v1/catalog/${sf}/albums/${id}`;
  const d = await ampGet(path, { include: "tracks", "limit[tracks]": 100 });
  const album = d?.data?.[0];
  if (!album) throw new Error(`album ${id} not found`);
  const a = album.attributes ?? {};
  const tracks: Track[] = (album.relationships?.tracks?.data ?? []).map(songToTrack);
  const totalMs = tracks.reduce((sum, t) => sum + (t.durationSeconds ?? 0) * 1000, 0);
  return {
    id: String(album.id),
    title: a.name ?? "",
    artists: a.artistName ? [{ id: null, name: a.artistName }] : [],
    year: a.releaseDate ? (/\b(19|20)\d{2}\b/.exec(a.releaseDate)?.[0] ?? null) : null,
    trackCount: a.trackCount ? `${a.trackCount} songs` : tracks.length ? `${tracks.length} songs` : null,
    duration: msToDuration(totalMs),
    thumbnailURL: artworkURL(a.artwork, 1200),
    tracks,
    playlistId: null,
  };
}

// ---------- Playlist ----------
export async function handlePlaylist(id: string): Promise<PlaylistDetail> {
  const sf = await getStorefront();
  const path = isLib(id, "p.") ? `/v1/me/library/playlists/${id}` : `/v1/catalog/${sf}/playlists/${id}`;
  const d = await ampGet(path, { include: "tracks", "limit[tracks]": 100 });
  const pl = d?.data?.[0];
  if (!pl) throw new Error(`playlist ${id} not found`);
  const a = pl.attributes ?? {};
  const trackRel = pl.relationships?.tracks ?? {};
  const tracks: Track[] = (trackRel.data ?? []).map(songToTrack);
  return {
    id: String(pl.id),
    title: a.name ?? "",
    author: a.curatorName ?? null,
    description: a.description?.standard ?? a.description?.short ?? null,
    trackCount: a.trackCount ? `${a.trackCount} songs` : null,
    thumbnailURL: artworkURL(a.artwork, 1200),
    tracks,
    continuation: trackRel.next ?? null,
    canEdit: a.canEdit === true,
  };
}

export async function handlePlaylistMore(_id: string, continuation: string): Promise<TrackPage> {
  const d = await ampGet(continuation);
  const tracks: Track[] = (d?.data ?? []).map(songToTrack);
  return { tracks, continuation: d?.next ?? null };
}

// ---------- Artist ----------
export async function handleArtist(id: string): Promise<ArtistDetail> {
  const sf = await getStorefront();

  // Library artist
  if (isLib(id, "r.")) {
    try {
      const cat = await ampGet(`/v1/me/library/artists/${id}/catalog`);
      const catId = cat?.data?.[0]?.id;
      if (catId) return handleArtist(String(catId));
    } catch {
      /* fall through to basic */
    }
    const d = await ampGet(`/v1/me/library/artists/${id}`, { "include[library-artists]": "albums" });
    const ar = d?.data?.[0];
    const albums: SearchAlbum[] = (ar?.relationships?.albums?.data ?? []).map(albumToSearch);
    return {
      id: String(id),
      name: ar?.attributes?.name ?? "",
      thumbnailURL: null,
      subtitle: null,
      topTracks: [],
      albums,
      singles: [],
      playlists: [],
      relatedArtists: [],
    };
  }

  const d = await ampGet(`/v1/catalog/${sf}/artists/${id}`, {
    views: "top-songs,full-albums,similar-artists",
    "limit[artists:top-songs]": 12,
    "limit[artists:full-albums]": 16,
    "limit[artists:similar-artists]": 12,
  });
  const ar = d?.data?.[0];
  if (!ar) throw new Error(`artist ${id} not found`);
  const a = ar.attributes ?? {};
  const views = ar.views ?? {};

  const topTracks: Track[] = (views["top-songs"]?.data ?? []).map(songToTrack);
  const allAlbums = (views["full-albums"]?.data ?? []) as any[];
  const albums: SearchAlbum[] = [];
  const singles: SearchAlbum[] = [];
  for (const al of allAlbums) {
    (al.attributes?.isSingle ? singles : albums).push(albumToSearch(al));
  }
  const relatedArtists: SearchArtist[] = (views["similar-artists"]?.data ?? []).map(artistToSearch);

  return {
    id: String(ar.id),
    name: a.name ?? "",
    thumbnailURL: artworkURL(a.artwork, 1200),
    subtitle: a.genreNames?.[0] ?? null,
    topTracks,
    albums,
    singles,
    playlists: [],
    relatedArtists,
  };
}
