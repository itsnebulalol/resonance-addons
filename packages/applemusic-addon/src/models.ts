import type {
  AlbumRef as SDKAlbumRef,
  ArtistRef as SDKArtistRef,
  PlaylistArtworkUpdate as SDKPlaylistArtworkUpdate,
  PlaylistDetail as SDKPlaylistDetail,
  PlaylistEntry as SDKPlaylistEntry,
  PlaylistEntryPage as SDKPlaylistEntryPage,
  PlaylistUpdateRequest as SDKPlaylistUpdateRequest,
  Station as SDKStation,
  Track as SDKTrack,
} from "@resonance-addons/sdk";

export type AlbumRef = SDKAlbumRef;
export type ArtistRef = SDKArtistRef;
export type Track = SDKTrack;
export type Station = SDKStation;
export type PlaylistEntry = SDKPlaylistEntry;
export type PlaylistDetail = SDKPlaylistDetail;
export type PlaylistEntryPage = SDKPlaylistEntryPage;
export type PlaylistArtworkUpdate = SDKPlaylistArtworkUpdate;
export type PlaylistUpdateRequest = SDKPlaylistUpdateRequest;

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

export interface QueueContinuation {
  providerID: string;
  token: string;
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
  type: "playTrack" | "openPlaylist" | "openAlbum";
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
