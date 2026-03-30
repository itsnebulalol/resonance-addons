import { AddonError } from "@resonance-addons/sdk";
import { ytFetch } from "../auth";
import type { CatalogPage, HomeItem, HomeSection, SearchAlbum, SearchArtist, SearchPlaylist, Track } from "../types";
import { bestThumbnail, PROVIDER_ID } from "../utils";

function parseDurationStr(dur: string): number | null {
  const parts = dur.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return null;
}

function extractSectionContents(data: any): any[] {
  return (
    data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ??
    []
  );
}

function extractRawItems(sectionContents: any[]): { items: any[]; continuation: string | null } {
  const items: any[] = [];
  let continuation: string | null = null;
  for (const section of sectionContents) {
    const shelf = section?.musicShelfRenderer;
    if (shelf) {
      items.push(...(shelf.contents ?? []));
      continuation ??= shelf.continuations?.[0]?.nextContinuationData?.continuation ?? null;
    }
    const grid = section?.gridRenderer;
    if (grid) {
      items.push(...(grid.items ?? []));
      continuation ??= grid.continuations?.[0]?.nextContinuationData?.continuation ?? null;
    }
  }
  return { items, continuation };
}

function renderersFromItems(items: any[]): any[] {
  const renderers: any[] = [];
  for (const item of items) {
    const renderer = item.musicTwoColumnItemRenderer ?? item.musicTwoRowItemRenderer;
    if (renderer) renderers.push(renderer);
  }
  return renderers;
}

async function fetchPageRenderers(
  refreshToken: string,
  browseId: string,
  continuationToken?: string,
): Promise<{ renderers: any[]; continuationToken: string | null }> {
  if (continuationToken) {
    const page = await ytFetch("browse", refreshToken, { continuation: continuationToken });
    const contSection = page?.continuationContents?.sectionListContinuation;
    if (!contSection) return { renderers: [], continuationToken: null };
    const { items, continuation } = extractRawItems(contSection.contents ?? []);
    return { renderers: renderersFromItems(items), continuationToken: continuation };
  }
  const firstPage = await ytFetch("browse", refreshToken, { browseId });
  const { items, continuation } = extractRawItems(extractSectionContents(firstPage));
  return { renderers: renderersFromItems(items), continuationToken: continuation };
}

async function fetchPageShelfItems(
  refreshToken: string,
  browseId: string,
  continuationToken?: string,
): Promise<{ items: any[]; continuationToken: string | null }> {
  if (continuationToken) {
    const page = await ytFetch("browse", refreshToken, { continuation: continuationToken });
    const contSection = page?.continuationContents?.sectionListContinuation;
    if (!contSection) return { items: [], continuationToken: null };
    const { items, continuation } = extractRawItems(contSection.contents ?? []);
    return { items, continuationToken: continuation };
  }
  const firstPage = await ytFetch("browse", refreshToken, { browseId });
  const { items, continuation } = extractRawItems(extractSectionContents(firstPage));
  return { items, continuationToken: continuation };
}

function getThumbnailUrl(renderer: any): string | null {
  const thumbnails =
    renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
    renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
    [];
  return bestThumbnail(thumbnails);
}

function parsePlaylists(renderers: any[]): HomeItem[] {
  const items: HomeItem[] = [];
  for (const renderer of renderers) {
    const browseId = renderer.navigationEndpoint?.browseEndpoint?.browseId;
    if (!browseId) continue;

    const title = renderer.title?.runs?.[0]?.text ?? "";
    const subtitleRuns = renderer.subtitle?.runs ?? [];
    const subtitle = subtitleRuns.map((r: any) => r.text).join("");

    const playlist: SearchPlaylist = {
      id: browseId,
      provider: PROVIDER_ID,
      title,
      author: subtitle || null,
      trackCount: null,
      thumbnailURL: getThumbnailUrl(renderer),
    };
    items.push({ type: "playlist", playlist });
  }
  return items;
}

function parseSongs(rawItems: any[]): HomeItem[] {
  const items: HomeItem[] = [];
  for (const item of rawItems) {
    const renderer = item.musicTwoColumnItemRenderer;
    if (!renderer) continue;

    const videoId = renderer.navigationEndpoint?.watchEndpoint?.videoId;
    if (!videoId) continue;

    const title = renderer.title?.runs?.[0]?.text ?? "";
    const subtitleRuns: any[] = renderer.subtitle?.runs ?? [];

    const artistName = subtitleRuns[0]?.text ?? "Unknown";
    const lastRun = subtitleRuns[subtitleRuns.length - 1]?.text ?? null;
    const durationStr = lastRun && /^\d+:\d+/.test(lastRun) ? lastRun : null;

    let album: Track["album"] = null;
    const menuItems = renderer.menu?.menuRenderer?.items ?? [];
    for (const mi of menuItems) {
      const nav = mi.menuNavigationItemRenderer;
      if (!nav) continue;
      const browseEp = nav.navigationEndpoint?.browseEndpoint;
      const pt = browseEp?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
      if (pt === "MUSIC_PAGE_TYPE_ALBUM" && browseEp?.browseId) {
        album = { id: browseEp.browseId, name: "" };
        break;
      }
    }

    const track: Track = {
      id: videoId,
      provider: PROVIDER_ID,
      title,
      artists: [{ id: null, name: artistName }],
      album,
      duration: durationStr,
      durationSeconds: durationStr ? parseDurationStr(durationStr) : null,
      thumbnailURL: getThumbnailUrl(renderer),
      isExplicit: false,
    };
    items.push({ type: "track", track });
  }
  return items;
}

function parseAlbums(renderers: any[]): HomeItem[] {
  const items: HomeItem[] = [];
  for (const renderer of renderers) {
    const browseId = renderer.navigationEndpoint?.browseEndpoint?.browseId;
    if (!browseId) continue;

    const title = renderer.title?.runs?.[0]?.text ?? "";
    const subtitleRuns: any[] = renderer.subtitle?.runs ?? [];
    const subtitle = subtitleRuns.map((r: any) => r.text).join("");

    const parts = subtitle.split(" • ");
    const artistName = parts[1] ?? "Unknown";
    const year = parts[2] ?? null;

    const album: SearchAlbum = {
      id: browseId,
      provider: PROVIDER_ID,
      title,
      artists: [{ id: null, name: artistName }],
      year,
      thumbnailURL: getThumbnailUrl(renderer),
      isExplicit: false,
    };
    items.push({ type: "album", album });
  }
  return items;
}

function parseArtists(renderers: any[]): HomeItem[] {
  const items: HomeItem[] = [];
  for (const renderer of renderers) {
    const rawId = renderer.navigationEndpoint?.browseEndpoint?.browseId;
    if (!rawId) continue;
    const browseId = rawId.startsWith("MPLA") ? rawId.slice(4) : rawId;

    const name = renderer.title?.runs?.[0]?.text ?? "";

    const artist: SearchArtist = {
      id: browseId,
      provider: PROVIDER_ID,
      name,
      thumbnailURL: getThumbnailUrl(renderer),
      subscriberCount: null,
    };
    items.push({ type: "artist", artist });
  }
  return items;
}

const BROWSE_IDS: Record<string, string> = {
  playlists: "FEmusic_liked_playlists",
  songs: "FEmusic_liked_videos",
  albums: "FEmusic_liked_albums",
  artists: "FEmusic_library_corpus_track_artists",
};

export async function handleLibrary(refreshToken: string, type?: string, continuation?: string): Promise<CatalogPage> {
  try {
    if (type) {
      const browseId = BROWSE_IDS[type];
      if (!browseId) throw new AddonError(`Invalid library type: ${type}`, 400);

      let section: HomeSection;
      if (type === "songs") {
        const { items, continuationToken } = await fetchPageShelfItems(refreshToken, browseId, continuation);
        section = {
          id: crypto.randomUUID(),
          title: "Songs",
          items: parseSongs(items),
          style: "cards",
          continuationToken: continuationToken ?? undefined,
        };
      } else {
        const { renderers, continuationToken } = await fetchPageRenderers(refreshToken, browseId, continuation);
        const parseFn = type === "playlists" ? parsePlaylists : type === "albums" ? parseAlbums : parseArtists;
        const title = type === "playlists" ? "Playlists" : type === "albums" ? "Albums" : "Artists";
        section = {
          id: crypto.randomUUID(),
          title,
          items: parseFn(renderers),
          style: "cards",
          continuationToken: continuationToken ?? undefined,
        };
      }

      return { sections: [section], filters: [], quickAccess: null, continuation: null } satisfies CatalogPage;
    }

    const [playlistPage, songPage, albumPage, artistPage] = await Promise.all([
      fetchPageRenderers(refreshToken, "FEmusic_liked_playlists"),
      fetchPageShelfItems(refreshToken, "FEmusic_liked_videos"),
      fetchPageRenderers(refreshToken, "FEmusic_liked_albums"),
      fetchPageRenderers(refreshToken, "FEmusic_library_corpus_track_artists"),
    ]);

    const sections: HomeSection[] = [];

    const playlists = parsePlaylists(playlistPage.renderers);
    if (playlists.length > 0) {
      sections.push({
        id: crypto.randomUUID(),
        title: "Playlists",
        items: playlists,
        style: "cards",
        continuationToken: playlistPage.continuationToken ?? undefined,
      });
    }

    const songs = parseSongs(songPage.items);
    if (songs.length > 0) {
      sections.push({
        id: crypto.randomUUID(),
        title: "Songs",
        items: songs,
        style: "cards",
        continuationToken: songPage.continuationToken ?? undefined,
      });
    }

    const albums = parseAlbums(albumPage.renderers);
    if (albums.length > 0) {
      sections.push({
        id: crypto.randomUUID(),
        title: "Albums",
        items: albums,
        style: "cards",
        continuationToken: albumPage.continuationToken ?? undefined,
      });
    }

    const artists = parseArtists(artistPage.renderers);
    if (artists.length > 0) {
      sections.push({
        id: crypto.randomUUID(),
        title: "Artists",
        items: artists,
        style: "cards",
        continuationToken: artistPage.continuationToken ?? undefined,
      });
    }

    return { sections, filters: [], quickAccess: null, continuation: null } satisfies CatalogPage;
  } catch (e: any) {
    console.error("Library error:", e.message);
    if (e instanceof AddonError) throw e;
    throw new AddonError(e.message, 500);
  }
}
