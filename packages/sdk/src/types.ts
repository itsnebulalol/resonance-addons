export interface AuthField {
  key: string;
  type: string;
  title: string;
  placeholder?: string;
  options?: string[];
  defaultValue?: string;
  isRequired?: boolean;
}

export interface AddonIcon {
  type: string;
  value: string;
}

export interface CatalogManifestEntry {
  id: string;
  name: string;
  extra?: any[];
  isDefault?: boolean;
}

export interface ResourceDefinition {
  type: string;
  idPrefixes?: string[];
  catalogs?: CatalogManifestEntry[];
  syncTypes?: string[];
}

export interface AuthDefinition {
  type: string;
  label?: string;
  fields?: AuthField[];
}

export interface ConfigField {
  key: string;
  type: string;
  title: string;
  placeholder?: string;
  options?: string[];
  defaultValue?: string;
  isRequired?: boolean;
}

export interface BehaviorHints {
  configurable?: boolean;
  configurationRequired?: boolean;
}

export interface Capabilities {
  supportsRadio?: boolean;
  supportsStations?: boolean;
  supportsQueueActions?: boolean;
  supportsContinuation?: boolean;
  supportsSearchSuggestions?: boolean;
  supportsLikeStatus?: boolean;
  supportsAddToPlaylist?: boolean;
  supportsCreatePlaylist?: boolean;
  supportsEditPlaylist?: boolean;
  supportsRemoveFromPlaylist?: boolean;
  supportsDeletePlaylist?: boolean;
  supportsFilters?: boolean;
  supportsQuickAccess?: boolean;
  supportsRelated?: boolean;
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
  isStationRetrigger?: boolean;
  payload: QueueActionPayload;
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

export interface DJScriptSlot {
  trackId: string;
  text?: string | null;
  audio?: DJAudioPayload | null;
  presentation?: DJNarrationPresentation | null;
  position: "beforeTrack" | "afterTrack";
}

export interface DJScript {
  slots: DJScriptSlot[];
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

export interface PlaylistEntryPage {
  entries: PlaylistEntry[];
  continuation: string | null;
}

export function playlistRevision(title: string, entries: PlaylistEntry[]): string {
  const value = [title, ...entries.map((entry) => entry.id)].join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1:${(hash >>> 0).toString(16).padStart(8, "0")}:${entries.length}`;
}

export type StreamTransport = "progressive" | "completeFile";

export type StreamContainer =
  | "m4a"
  | "mp4"
  | "fragmentedMp4"
  | "adts"
  | "mp3"
  | "flac"
  | "wav"
  | "caf"
  | "aiff"
  | "unknown";

export type StreamCodec = "aac" | "alac" | "mp3" | "flac" | "pcm" | "unknown";

export type StreamSeekMode = "byteRange" | "timeReprepare" | "restartFromZero" | "none";

export type StreamRangeSupport = "bytes" | "none" | "unknown";

export type StreamReadiness = "ready" | "preparing";

export type StreamCachePolicy = "cacheable" | "ephemeral";

export type StreamPartialPersistence = "none" | "validatedRanges" | "immutablePrefix";

export type StreamHTTPMethod = "get" | "post" | "delete";

export interface StreamControlRequest {
  url: string;
  method: StreamHTTPMethod;
  requestHeaders: Record<string, string>;
}

export interface StreamPreparation {
  id: string;
  statusRequest: StreamControlRequest | null;
  cancelRequest: StreamControlRequest | null;
  refreshRequest: StreamControlRequest | null;
}

export interface ReadyStream {
  schemaVersion: 1;
  state: "ready";
  url: string;
  transport: StreamTransport;
  container: StreamContainer;
  codec: StreamCodec;
  requestHeaders: Record<string, string>;
  bitrate: number | null;
  durationSeconds: number | null;
  contentLength: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channelCount: number | null;
  rangeSupport: StreamRangeSupport;
  seekMode: StreamSeekMode;
  expiresAtUnixMilliseconds: number | null;
  cacheIdentity: string;
  cachePolicy: StreamCachePolicy;
  partialPersistence: StreamPartialPersistence;
  preparation: StreamPreparation | null;
}

export interface PreparingStream {
  schemaVersion: 1;
  state: "preparing";
  transport: StreamTransport;
  container: StreamContainer;
  codec: StreamCodec;
  bitrate: number | null;
  durationSeconds: number | null;
  contentLength: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channelCount: number | null;
  cacheIdentity: string;
  cachePolicy: StreamCachePolicy;
  partialPersistence: StreamPartialPersistence;
  preparation: StreamPreparation;
  pollAfterMilliseconds: number;
}

export type StreamDescriptor = ReadyStream | PreparingStream;

export interface HistoryEvent {
  playbackId: string;
  startedAtMs: number;
  reportedAtMs: number;
  listenedSeconds: number;
  positionSeconds: number;
  durationSeconds?: number | null;
  completed: boolean;
}

export interface AddonHandlers<TConfig> {
  resolveStream?: (config: TConfig, trackId: string) => Promise<StreamDescriptor>;
  recordHistory?: (config: TConfig, trackId: string, event: HistoryEvent) => Promise<void>;
  getCatalog?: (config: TConfig, id: string, extra?: any) => Promise<any>;
  applyFilter?: (config: TConfig, filterPayload: any) => Promise<any>;
  getQuickAccess?: (config: TConfig) => Promise<any[] | null>;
  getAlbumDetail?: (config: TConfig, id: string) => Promise<any>;
  getPlaylistDetail?: (config: TConfig, id: string) => Promise<any>;
  loadMorePlaylistEntries?: (config: TConfig, id: string, continuation: string) => Promise<PlaylistEntryPage>;
  getArtistDetail?: (config: TConfig, id: string) => Promise<any>;
  startQueue?: (config: TConfig, trackId: string, context?: any) => Promise<any>;
  startStation?: (config: TConfig, station: Station) => Promise<any>;
  loadMore?: (config: TConfig, token: string) => Promise<any>;
  executeAction?: (config: TConfig, action: any, currentTrack: any) => Promise<any>;
  search?: (config: TConfig, query: string, filter?: string, context?: any) => Promise<any[]>;
  searchSuggestions?: (config: TConfig, query: string) => Promise<string[]>;
  setLikeStatus?: (config: TConfig, status: string, videoId: string) => Promise<void>;
  getLikeStatus?: (config: TConfig, videoId: string) => Promise<string>;
  getFavoriteCollection?: (config: TConfig) => Promise<SearchPlaylist | null>;
  addToPlaylist?: (config: TConfig, trackId: string, playlistId: string) => Promise<void>;
  createPlaylist?: (config: TConfig, name: string) => Promise<any>;
  updatePlaylist?: (config: TConfig, request: PlaylistUpdateRequest) => Promise<PlaylistDetail>;
  removeFromPlaylist?: (config: TConfig, entryId: string, trackId: string, playlistId: string) => Promise<void>;
  deletePlaylist?: (config: TConfig, playlistId: string) => Promise<void>;
  getRelated?: (config: TConfig, browseId: string) => Promise<any[]>;
  getRelatedForTrack?: (config: TConfig, trackId: string) => Promise<any[]>;
  fetchLyrics?: (config: TConfig, title: string, artist: string, videoId: string) => Promise<any | null>;
  fetchMetadata?: (
    config: TConfig,
    title: string,
    artist: string,
    trackId?: string,
    trackProvider?: string,
    thumbnailURL?: string,
  ) => Promise<any>;
  translate?: (config: TConfig, lines: string[], language: string) => Promise<string[]>;
  getVoices?: (config: TConfig) => Promise<any[]>;
  synthesize?: (config: TConfig, text: string, voiceId?: string) => Promise<{ data: string; contentType: string }>;
  getModels?: (config: TConfig) => Promise<any[]>;
  respond?: (config: TConfig, request: any) => Promise<any>;
  generate?: (config: TConfig, prompt: string, aiConfig?: any) => Promise<string>;
}

export interface AddonDefinition<TConfig = Record<string, string>> {
  id: string;
  name: string;
  description: string;
  version: string;
  icon?: AddonIcon;
  resources: ResourceDefinition[];
  auth?: AuthDefinition;
  config?: ConfigField[];
  behaviorHints?: BehaviorHints;
  capabilities?: Capabilities;
  handlers: AddonHandlers<TConfig>;
}
