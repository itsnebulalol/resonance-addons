// Resonance canonical types (must match SDK/Swift definitions exactly)

export interface ArtistRef {
  id: string | null;
  name: string;
}

export interface AlbumRef {
  id: string | null;
  name: string;
}

export interface Track {
  id: string;
  provider: string;
  title: string;
  artists: ArtistRef[];
  album: AlbumRef | null;
  duration: string | null;
  durationSeconds: number | null;
  thumbnailURL: string | null;
  isExplicit: boolean;
  isEphemeral?: boolean | null;
  genres?: string[] | null;
  releaseYear?: number | null;
  albumArtists?: ArtistRef[] | null;
  trackNumber?: number | null;
  trackTotal?: number | null;
  discNumber?: number | null;
  discTotal?: number | null;
  bpm?: number | null;
  musicalKey?: string | null;
}

export interface SearchAlbum {
  id: string;
  provider: string;
  title: string;
  artists: ArtistRef[];
  year: string | null;
  thumbnailURL: string | null;
  isExplicit: boolean;
}

export interface SearchArtist {
  id: string;
  provider: string;
  name: string;
  thumbnailURL: string | null;
  subscriberCount: string | null;
}

export interface SearchPlaylist {
  id: string;
  provider: string;
  title: string;
  author: string | null;
  trackCount: string | null;
  thumbnailURL: string | null;
  canAddTracks?: boolean | null;
  canDelete?: boolean | null;
}

export interface Station {
  id: string;
  provider: string;
  title: string;
  subtitle: string | null;
  thumbnailURL: string | null;
}

export type HomeItem =
  | { type: "track"; track: Track; playlistId?: string }
  | { type: "station"; station: Station }
  | { type: "album"; album: SearchAlbum }
  | { type: "playlist"; playlist: SearchPlaylist }
  | { type: "artist"; artist: SearchArtist };

export interface HomeSection {
  id: string;
  title: string;
  items: HomeItem[];
  style: "cards" | "quickPicks" | "quickAccess";
  continuationToken?: string;
}

export interface CatalogPage {
  sections: HomeSection[];
  filters: CatalogFilter[];
  quickAccess: null;
  continuation: null;
}

export interface CatalogFilter {
  id: string;
  title: string;
  isSelected: boolean;
  payload: { providerID: string; data: Record<string, string> };
}

export interface QueueContinuation {
  providerID: string;
  token: string;
}

export interface QueueAction {
  id: string;
  title: string;
  isSelected: boolean;
  allowsPrefetch?: boolean;
  isMomentary?: boolean;
  shouldAdvancePlayback?: boolean;
  isStationRetrigger?: boolean;
  payload: { providerID: string; data: Record<string, string> };
}

export interface QueuePage {
  tracks: Track[];
  continuation: QueueContinuation | null;
  actions: QueueAction[];
  title: string | null;
  likeStatus: "liked" | "disliked" | "none" | null;
  playlistId?: string | null;
  relatedBrowseId?: string | null;
  djScript?: DJScript | null;
}

export interface DJScript {
  slots: DJScriptSlot[];
}

export interface DJScriptSlot {
  trackId: string;
  text?: string | null;
  audio?: DJAudioPayload | null;
  presentation?: DJNarrationPresentation | null;
  position: "beforeTrack" | "afterTrack";
}

export interface DJAudioPayload {
  data: string;
  contentType: string;
}

export interface DJNarrationPresentation {
  title?: string | null;
  artist?: string | null;
  artworkURL?: string | null;
}

export interface AlbumDetail {
  id: string;
  title: string;
  artists: ArtistRef[];
  year: string | null;
  trackCount: string | null;
  duration: string | null;
  thumbnailURL: string | null;
  tracks: Track[];
  playlistId: string | null;
}

export interface PlaylistDetail {
  id: string;
  title: string;
  author: string | null;
  description: string | null;
  trackCount: string | null;
  thumbnailURL: string | null;
  entries: PlaylistEntry[];
  continuation: string | null;
  revision: string | null;
  editCapabilities: PlaylistEditCapabilities;
}

export interface ArtistDetail {
  id: string;
  name: string;
  thumbnailURL: string | null;
  subtitle: string | null;
  topTracks: Track[];
  albums: SearchAlbum[];
  singles: SearchAlbum[];
  playlists: SearchPlaylist[];
  relatedArtists: SearchArtist[];
}

export interface PlaylistEntry {
  id: string;
  track: Track;
}

export interface PlaylistEditCapabilities {
  canRename: boolean;
  canChangeArtwork: boolean;
  canReorder: boolean;
  canRemoveItems: boolean;
}

export interface PlaylistArtworkUpdate {
  data: string;
  mimeType: string;
}

export interface PlaylistUpdateRequest {
  playlistID: string;
  name: string;
  entries: PlaylistEntry[];
  revision: string | null;
  artwork: PlaylistArtworkUpdate | null;
}

export interface PlaylistEntryPage {
  entries: PlaylistEntry[];
  continuation: string | null;
}

export type SearchResultItem =
  | { type: "track"; track: Track }
  | { type: "artist"; artist: SearchArtist }
  | { type: "album"; album: SearchAlbum }
  | { type: "playlist"; playlist: SearchPlaylist };

// Spotify Web API response types

export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  uri: string;
  images?: SpotifyImage[];
  followers?: { total: number };
  genres?: string[];
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  uri: string;
  artists: SpotifyArtist[];
  images: SpotifyImage[];
  release_date?: string;
  total_tracks?: number;
  album_type?: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  duration_ms: number;
  explicit: boolean;
  track_number?: number;
  disc_number?: number;
}

export interface SpotifyAudioFeatures {
  id: string;
  tempo?: number;
  key?: number;
  mode?: number;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
  description: string | null;
  images: SpotifyImage[];
  owner: { id: string; display_name: string | null };
  tracks: { total: number; items?: SpotifyPlaylistTrack[] };
}

export interface SpotifyPlaylistTrack {
  track: SpotifyTrack | null;
  added_at: string;
}

export interface SpotifyPaginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
  previous: string | null;
}

export interface SpotifyCursorPaginated<T> {
  items: T[];
  total?: number;
  limit: number;
  cursors: { after: string | null; before?: string | null } | null;
  next: string | null;
}

export interface SpotifySavedTrack {
  added_at: string;
  track: SpotifyTrack;
}

export interface SpotifySavedAlbum {
  added_at: string;
  album: SpotifyAlbum;
}

export interface SpotifyPlayHistory {
  track: SpotifyTrack;
  played_at: string;
  context: { type: string; uri: string } | null;
}

export interface SpotifyAlbumFull extends SpotifyAlbum {
  tracks: SpotifyPaginated<SpotifyTrack>;
  copyrights?: { text: string; type: string }[];
  label?: string;
}

export interface SpotifyArtistFull extends SpotifyArtist {
  followers: { total: number };
  genres: string[];
  popularity: number;
}
