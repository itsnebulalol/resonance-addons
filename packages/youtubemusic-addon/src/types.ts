export interface YouTubeMusicConfig {
  refreshToken: string;
  gl?: string;
  hl?: string;
}

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

export interface CatalogFilterPayload {
  providerID: string;
  data: Record<string, string>;
}

export interface CatalogFilter {
  id: string;
  title: string;
  isSelected: boolean;
  payload: CatalogFilterPayload;
}

export interface QuickAccessAction {
  type: "playTrack" | "openPlaylist" | "openAlbum" | "openArtist";
  trackId?: string;
  playlistId?: string;
  browseId?: string;
}

export interface QuickAccessItem {
  id: string;
  title: string;
  thumbnailURL: string | null;
  action: QuickAccessAction;
  artistName?: string | null;
}

export interface QueueContinuation {
  providerID: string;
  token: string;
}

export interface CatalogPage {
  sections: HomeSection[];
  filters: CatalogFilter[];
  quickAccess: QuickAccessItem[] | null;
  continuation: QueueContinuation | null;
}

export interface QueueActionPayload {
  providerID: string;
  data: Record<string, string>;
}

export interface QueueAction {
  id: string;
  title: string;
  isSelected: boolean;
  allowsPrefetch?: boolean;
  isMomentary?: boolean;
  shouldAdvancePlayback?: boolean;
  payload: QueueActionPayload;
}

export interface QueuePage {
  tracks: Track[];
  continuation: QueueContinuation | null;
  actions: QueueAction[];
  title: string | null;
  likeStatus: "liked" | "disliked" | "none" | null;
  playlistId?: string | null;
  relatedBrowseId?: string | null;
}

export type SearchResultItem =
  | { type: "track"; track: Track }
  | { type: "artist"; artist: SearchArtist }
  | { type: "album"; album: SearchAlbum }
  | { type: "playlist"; playlist: SearchPlaylist };

export type { StreamDescriptor } from "@resonance-addons/sdk";

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

export interface LyricsWord {
  id: number;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
}

export interface LyricsLine {
  id: number;
  startTimeMs: number;
  endTimeMs: number | null;
  text: string;
  words: LyricsWord[];
}

export interface LyricsData {
  syncType: "wordSynced" | "lineSynced" | "unsynced";
  lines: LyricsLine[];
}
