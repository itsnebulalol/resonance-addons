export interface AuthField {
  key: string;
  type: "text" | "password" | "toggle";
  title: string;
  placeholder?: string;
  isRequired?: boolean;
}

export interface AddonIcon {
  type: "remote" | "bundled";
  value: string;
}

export interface CatalogParams {
  continuation?: string;
  type?: string;
}

export interface LyricsParams {
  videoId?: string;
  title?: string;
  artist?: string;
}

export interface MetadataParams {
  title?: string;
  artist?: string;
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

export interface CatalogDefinition<T> {
  name: string;
  isDefault?: boolean;
  manifest?: boolean;
  handler: (config: T, params: CatalogParams) => Promise<Response>;
}

export interface StreamDefinition<T> {
  idPrefixes: string[];
  handler: (config: T, id: string) => Promise<Response>;
}

export interface SearchDefinition<T> {
  handler: (config: T, query: string, filter: string | undefined, url: URL) => Promise<Response>;
  suggestions?: (config: T, query: string) => Promise<Response>;
}

export interface LyricsDefinition<T> {
  syncTypes: string[];
  handler: (config: T, params: LyricsParams) => Promise<Response>;
}

export interface MetadataDefinition<T> {
  handler: (config: T, params: MetadataParams) => Promise<Response>;
}

export interface PlaylistDefinition<T> {
  handler: (config: T, id: string) => Promise<Response>;
  more?: (config: T, id: string, continuation: string) => Promise<Response>;
  custom?: Record<string, (config: T) => Promise<Response>>;
}

export interface RelatedDefinition<T> {
  handler: (config: T, id: string) => Promise<Response>;
  forTrack?: (config: T, id: string) => Promise<Response>;
}

export interface QueueDefinition<T> {
  start: (config: T, id: string, context?: string) => Promise<Response>;
  more: (config: T, token: string) => Promise<Response>;
  action: (config: T, body: any) => Promise<Response>;
}

export interface MutationsDefinition<T> {
  like?: (config: T, body: any) => Promise<Response>;
  addToPlaylist?: (config: T, body: any) => Promise<Response>;
}

export interface TTSDefinition<T> {
  voices: unknown[];
  handler: (config: T, request: Request) => Promise<Response>;
}

export interface AddonOptions<T> {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: AddonIcon;

  auth: {
    type?: "token";
    label: string;
    fields: AuthField[];
  };

  capabilities?: Partial<Capabilities>;
  configurePage?: string;
  onDeviceFetchHosts?: string[];

  parseConfig: (raw: Record<string, any>) => T;
  wrapRequest?: (config: T, handler: () => Promise<Response>) => Promise<Response>;
  onStart?: () => Promise<void> | void;
  onConfig?: (config: T) => void;

  stream?: StreamDefinition<T>;
  catalog?: Record<string, CatalogDefinition<T>>;
  search?: SearchDefinition<T>;
  lyrics?: LyricsDefinition<T>;
  metadata?: MetadataDefinition<T>;
  album?: (config: T, id: string) => Promise<Response>;
  artist?: (config: T, id: string) => Promise<Response>;
  playlist?: PlaylistDefinition<T>;
  related?: RelatedDefinition<T>;
  queue?: QueueDefinition<T>;
  mutations?: MutationsDefinition<T>;
  tts?: TTSDefinition<T>;
}
