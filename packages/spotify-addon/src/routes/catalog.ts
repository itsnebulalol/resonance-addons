import { AddonError } from "@resonance-addons/sdk";
import type { CatalogPage, HomeItem, HomeSection, SearchAlbum, SearchArtist, SearchPlaylist } from "../types";
import { bestImageFromSources, OperationHash, PROVIDER_ID, pf, transformGraphQLTrack, uriToId } from "../utils";

const SKIP_TYPENAMES = new Set([
  "PodcastOrAudiobookResponseWrapper",
  "EpisodeOrChapterResponseWrapper",
  "UnknownType",
  "NonMusicItem",
  "NotFound",
]);

const SKIP_URI_PREFIXES = ["spotify:show:", "spotify:episode:", "spotify:audiobook:"];

function isSkippableItem(uri: string, typename?: string): boolean {
  if (typename && SKIP_TYPENAMES.has(typename)) return true;
  return SKIP_URI_PREFIXES.some((p) => uri.startsWith(p));
}

function flattenImageSources(items: any[] | undefined): any[] {
  const sources: any[] = [];
  for (const item of items ?? []) {
    sources.push(...(item?.sources ?? []));
  }
  return sources;
}

function parseHomeItem(item: any): HomeItem | null {
  const uri = item?.uri as string | undefined;
  const contentWrapper = item?.content;
  const contentData = contentWrapper?.data ?? contentWrapper;
  if (!uri || !contentData) return null;

  if (uri === "spotify:user:@:collection") {
    const playlist: SearchPlaylist = {
      id: "tracks",
      provider: PROVIDER_ID,
      title: "Liked Songs",
      author: null,
      trackCount: null,
      thumbnailURL: "https://misc.scdn.co/liked-songs/liked-songs-640.png",
    };
    return { type: "playlist", playlist };
  }

  const wrapperType = contentWrapper?.__typename as string | undefined;
  const innerType = contentData.__typename as string | undefined;

  if (isSkippableItem(uri, wrapperType) || isSkippableItem(uri, innerType)) return null;

  if (innerType === "Playlist" || wrapperType === "PlaylistResponseWrapper" || uri.includes(":playlist:")) {
    const playlist: SearchPlaylist = {
      id: uriToId(uri),
      provider: PROVIDER_ID,
      title: contentData.name ?? "",
      author: contentData.ownerV2?.data?.name ?? contentData.owner?.name ?? null,
      trackCount: null,
      thumbnailURL: bestImageFromSources(flattenImageSources(contentData.images?.items)),
    };
    return { type: "playlist", playlist };
  }

  if (innerType === "Album" || wrapperType === "AlbumResponseWrapper" || uri.includes(":album:")) {
    const album: SearchAlbum = {
      id: uriToId(uri),
      provider: PROVIDER_ID,
      title: contentData.name ?? "",
      artists: (contentData.artists?.items ?? []).map((a: any) => ({
        id: a.uri ? uriToId(a.uri) : null,
        name: a.profile?.name ?? a.name ?? "",
      })),
      year: typeof contentData.date?.isoString === "string" ? contentData.date.isoString.slice(0, 4) : null,
      thumbnailURL: bestImageFromSources(contentData.coverArt?.sources ?? []),
      isExplicit: false,
    };
    return { type: "album", album };
  }

  if (innerType === "Artist" || uri.includes(":artist:")) {
    const artist: SearchArtist = {
      id: uriToId(uri),
      provider: PROVIDER_ID,
      name: contentData.profile?.name ?? contentData.name ?? "",
      thumbnailURL: bestImageFromSources(contentData.visuals?.avatarImage?.sources ?? []),
      subscriberCount: null,
    };
    return { type: "artist", artist };
  }

  if (innerType === "Track" || uri.includes(":track:")) {
    if (!contentData.uri && uri) contentData.uri = uri;
    return { type: "track", track: transformGraphQLTrack(contentData) };
  }

  return null;
}

function parseSpeedDial(section: any): HomeSection | null {
  const rawItems = section?.sectionItems?.items ?? [];
  const items: HomeItem[] = [];
  for (const item of rawItems) {
    const parsed = parseHomeItem(item);
    if (parsed) items.push(parsed);
  }
  if (items.length === 0) return null;
  return {
    id: `speed-dial-${Math.random().toString(36).slice(2, 10)}`,
    title: "Speed dial",
    items,
    style: "quickAccess",
  };
}

const SKIP_SECTION_TYPES = new Set(["HomeShortsSectionData", "HomeFeedBaselineSectionData"]);

function parseHomeSection(section: any): HomeSection | null {
  const sectionData = section?.data;
  const typename = sectionData?.__typename as string | undefined;

  if (typename && SKIP_SECTION_TYPES.has(typename)) return null;

  const title = sectionData?.title?.transformedLabel ?? sectionData?.title?.text ?? "";
  if (typeof title !== "string" || !title) return null;

  const rawItems = section?.sectionItems?.items ?? [];
  const items: HomeItem[] = [];
  for (const item of rawItems) {
    const parsed = parseHomeItem(item);
    if (parsed) items.push(parsed);
  }
  if (items.length === 0) return null;

  return {
    id: `home-${title.toLowerCase().replace(/\s+/g, "-")}-${Math.random().toString(36).slice(2, 10)}`,
    title,
    items,
    style: "cards",
  };
}

export async function handleHome(spDc: string): Promise<CatalogPage> {
  try {
    const tz = Intl?.DateTimeFormat?.().resolvedOptions?.()?.timeZone ?? "America/Los_Angeles";
    const data = await pf(spDc, {
      name: "home",
      hash: OperationHash.home,
      variables: {
        timeZone: tz,
        sp_t: "",
        country: "",
        facet: null,
        sectionItemsLimit: 15,
      },
    });

    const rawSections = data?.home?.sectionContainer?.sections?.items ?? [];
    const sections: HomeSection[] = [];

    for (const raw of rawSections) {
      const typename = raw?.data?.__typename as string | undefined;

      if (typename === "HomeShortsSectionData") {
        const speedDial = parseSpeedDial(raw);
        if (speedDial) sections.push(speedDial);
        continue;
      }

      const section = parseHomeSection(raw);
      if (section) sections.push(section);
    }

    return { sections, filters: [], quickAccess: null, continuation: null };
  } catch (e: any) {
    if (e instanceof AddonError) throw e;
    throw new AddonError(e?.message ?? "Failed to load Spotify home", 500);
  }
}
