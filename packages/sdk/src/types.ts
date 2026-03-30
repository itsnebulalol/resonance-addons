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
  supportsQueueActions?: boolean;
  supportsContinuation?: boolean;
  supportsSearchSuggestions?: boolean;
  supportsLikeStatus?: boolean;
  supportsAddToPlaylist?: boolean;
  supportsFilters?: boolean;
  supportsQuickAccess?: boolean;
  supportsRelated?: boolean;
}

export interface AddonHandlers<TConfig> {
  resolveStream?: (config: TConfig, trackId: string) => Promise<any>;
  getCatalog?: (config: TConfig, id: string, extra?: any) => Promise<any>;
  applyFilter?: (config: TConfig, filterPayload: any) => Promise<any>;
  getQuickAccess?: (config: TConfig) => Promise<any[] | null>;
  getAlbumDetail?: (config: TConfig, id: string) => Promise<any>;
  getPlaylistDetail?: (config: TConfig, id: string) => Promise<any>;
  loadMorePlaylistTracks?: (config: TConfig, id: string, continuation: string) => Promise<any>;
  getArtistDetail?: (config: TConfig, id: string) => Promise<any>;
  startQueue?: (config: TConfig, trackId: string, context?: any) => Promise<any>;
  loadMore?: (config: TConfig, token: string) => Promise<any>;
  executeAction?: (config: TConfig, action: any, currentTrack: any) => Promise<any>;
  search?: (config: TConfig, query: string, filter?: string, context?: any) => Promise<any[]>;
  searchSuggestions?: (config: TConfig, query: string) => Promise<string[]>;
  setLikeStatus?: (config: TConfig, status: string, videoId: string) => Promise<void>;
  getLikeStatus?: (config: TConfig, videoId: string) => Promise<string>;
  addToPlaylist?: (config: TConfig, trackId: string, playlistId: string) => Promise<void>;
  getRelated?: (config: TConfig, browseId: string) => Promise<any[]>;
  getRelatedForTrack?: (config: TConfig, trackId: string) => Promise<any[]>;
  fetchLyrics?: (config: TConfig, title: string, artist: string, videoId: string) => Promise<any | null>;
  fetchMetadata?: (config: TConfig, title: string, artist: string) => Promise<any>;
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
